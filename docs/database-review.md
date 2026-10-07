# Database Review — deterministic stock_movements ids (sync path)

Scope: uncommitted changes to `lib/models/stockMovements.js`,
`lib/sheets/syncStokDuaArah.js`, `test/helpers/mockSheets.js`.
Read-only review. No production files modified.

## Verdict

Mechanism is sound: `doc(String(id_movement)).set(payload)` gives the retry
idempotence the sync path needs, and reads (`ambilPergerakanByKode` etc.) are
keyed on fields, not on id shape, so they keep working. Two real risks remain:
collision blast radius of the deterministic id, and overwrite dropping fields
on retry. Both are MINOR/IMPORTANT, not blockers for this feature.

---

## 1. Document-id design — no query/index impact

FAIL? no.

- Reads return `{ id: doc.id, ...doc.data() }` and consumers do not parse the
  id. `ambilPergerakanByKode` (`stockMovements.js:89-97`) filters on
  `kode_barang` and orders by `created_at`; `ambilPergerakanByPembuat`
  (`:99-107`) filters `created_by`; `ambilPergerakanTerakhir` (`:109-116`)
  orders `created_at`; `ambilPergerakanPending` (`:120-128`) filters `status`.
  None depend on doc-id randomness vs determinism.
- Firestore does not index or range-query arbitrary doc-id prefixes through
  these queries (they use `__name__` only as tiebreak in the existing composite
  indexes — `firestore.indexes.json:28,47,66,85,104`). A deterministic id is
  just a different `__name__` value; the composite index tiebreak still works.
- No `collectionGroup`/id-prefix query exists in the codebase
  (`grep sync_` finds no `where("__name__", ...)`). So no index change needed.
- Deviation: `.add()` previously produced 20-char auto-ids; new sync docs use
  `sync_<draftId>_<kode>`. Cosmetic and intended.

Severity: NIT (documented deviation, no action).

## 2. Overwrite-vs-add correctness

Correct for the stated goal.

- Optional param with `null` default (`stockMovements.js:37,79-84`) means every
  existing caller (bot handlers, API routes — `handleScreenshotPickingList.js:117`,
  `handleOpname.js:272`, `chatHandler.js:583`, etc.) keeps `.add()` behavior.
  No call-site migration required. Good.
- Sync path passes `id_movement` at both apply branches
  (`syncStokDuaArah.js:510` and `:596`), so a crash between movement write and
  `pushed_items` marker (`:519-525`, `:602-609`) is healed by overwrite on
  retry. Test `syncStokMovementIdempotensi.test.js:70-86` asserts exactly this.
- `pushed_items` remains as a skip optimization; `id_movement` is the
  guarantee. The comment at `:474-477` states this accurately.

Severity: none.

## 3. Deterministic id collision surface

**IMPORTANT.** `sync_${draft.id}_${item.kode_barang}` is collision-free for the
intended unit (one movement per draft+product), because:
- `draft.id` is a Firestore auto-id (`simpanDraftPerKelompok`, `:210-219`),
  unique per draft document.
- `kode_barang` separates products within one draft.
- A new `/sync_stok` run creates a fresh draft (new auto-id), so subsequent
  syncs of the same product get distinct movement ids. Correct.

But the id is only as unique as its inputs, and there are no constraints on
either:
- `kode_barang` may contain any character. Firestore document ids cannot
  contain `/`. If any product code ever contains `/` (or a draft id somehow
  does), `.doc(id)` will throw or address a subcollection path, not a movement
  doc. Today codes look alphanumeric (`cariBarisSheetByKode` compares string
  equality), so this is latent. Recommend encoding/whitelisting `kode_barang`
  in the id, or assert at the boundary.
- More subtle: the id is derived from *mutable app data* (`kode_barang`), not
  a pure immutable key. If an operator ever renames a product code and re-syncs
  the same draft, the movement lands under a new id — two movements for one
  draft+logical product. Low likelihood (drafts are one-shot), but it means the
  "idempotent" guarantee is keyed to a field that is not immutable.
- The length is bounded only by draft id + code length; fine for Firestore's
  1500-byte limit in practice.

Severity: IMPORTANT (input char safety); MINOR (mutability coupling).

## 4. Field overwrite risk (set replaces whole doc)

**IMPORTANT.** `.set(payload)` without `{ merge: true }` (`stockMovements.js:82`)
replaces the whole document. For the very first write this is identical to
`.add()`. For a retry it *rewrites every field from the new payload*. Two
concrete consequences:

1. **`created_at` is reset on every retry** (`stockMovements.js:70`,
   `created_at: new Date()` computed fresh each call). So the audit timestamp of
   a sync movement reflects the *last* retry attempt, not when the movement was
   first recorded. For an audit trail (`stockMovements.js:2` says "audit trail
   semua perubahan stok"), this is a real semantic drift: a crash-retry at
   T+1h makes the movement look like it happened at T+1h. A true idempotent
   overwrite should preserve the original `created_at` (read-then-set, or use
   `serverTimestamp` only on create and leave untouched on update).
2. **Any field added out-of-band is dropped.** E.g. if a later feature writes
   an extra key onto the movement doc, a retry of the sync overwrite erases it.
   Currently no such reader, so impact is theoretical, but it is a sharp edge
   waiting for the next feature.

The two sync call sites both set `type: "sync_confirmed"` and
`action_type: "kurangi_stok"` with identical other fields across apply paths,
so the *content* of the overwrite is currently stable — the timestamp is the
only per-retry change.

Severity: IMPORTANT (created_at audit semantics on retry).

## 5. Data integrity / audit-trail concerns vs existing schema

**MINOR.**

- `qty` on the sync path is a computed delta: `nilaiFinal - stokSebelum` where
  `stokSebelum` is read live via `bacaParitasOnline(await ambilStok(...))`
  (`syncStokDuaArah.js:495-501`, `:580-586`). On the *first* apply this is
  correct. On a *retry*, `tandaiTersinkron` was already called (`:489`, `:576`),
  so `stokSebelum` now equals `nilaiFinal`, making the recomputed `qty = 0` —
  and because `.set()` overwrites, the stored movement's `qty` flips from the
  real delta to `0`. The id stays single (good), but its `qty` is silently
  zeroed. The test at `syncStokMovementIdempotensi.test.js` checks count and id,
  not `qty`, so this is uncovered.
  - Followup: on any retry where the marker was absent but `tandaiTersinkron`
    had already run, the audit row loses its delta. Recommend preserving the
    original movement (skip re-write if doc exists, or compute qty from a
    persisted value), or at least assert qty stability in a test.
- No cross-collection FK is enforceable here (Firestore), so `draft.id`
  referencing a possibly-deleted draft is fine — movement is intentionally
  standalone audit.
- Multi-tenant/row-level: `stock_movements` is not tenant-scoped; ownership is
  via `owner_user_id` on the *draft* (`syncStokDuaArah.js:216`), and the
  movement carries `created_by`/`requested_by`. Server-side access is via
  environment credentials, not rules-based RLS. Consistent with existing design
  (see `docs/dashboard-prd.md:588`), so no new gap introduced by this change.

Severity: MINOR (qty-zero-on-retry, doc only).

## 6. Migration / rollout

- No schema migration. Adding an optional param is backward compatible; old
  code path (`.add`) untouched. Zero-downtime safe.
- Existing random-id docs and new deterministic-id docs coexist with no read
  path branching. No backfill required.
- No destructive operation anywhere in the diff. Script
  `scripts/backfillLastSyncedValue.js` is dry-run by default (`:8-11`) and
  guards on already-equal values (`:105`). Fine.
- `test/helpers/mockSheets.js` is test-only; correctly mirrors Sheets trailing-
  empty-cell trimming and append-after-last-nonempty semantics. Not production.

Severity: none.

## 7. Parameterization / injection

All writes go through Firestore SDK with object payloads; no string-built
queries. `.doc(String(id_movement))` is a path segment, not SQL. The only
safety concern is the `/` character in a path segment noted in finding 3.

Severity: NIT.

---

## Summary table

| # | Finding | File:line | Severity |
|---|---------|-----------|----------|
| 3 | Deterministic id built from raw `kode_barang`; `/` breaks `.doc()` path | syncStokDuaArah.js:510,596 | IMPORTANT |
| 4 | `set()` overwrites, resets `created_at` to retry time — audit drift | stockMovements.js:70,82 | IMPORTANT |
| 5 | Retry recomputes `qty=0` after `tandaiTersinkron`; uncovered by tests | syncStokDuaArah.js:489-501, 576-586 | MINOR |
| 3 | Id keyed on mutable `kode_barang`; rename breaks idempotence | syncStokDuaArah.js:510 | MINOR |
| 1 | Mixed random/deterministic ids — no index/query impact | stockMovements.js:82 | NIT |

No blockers. Recommend addressing #3 and #4 before relying on this as an
immutable audit trail; neither is required for the sync retry guarantee to
function.

CHANGES_REQUIRED
