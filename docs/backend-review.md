# Backend Review - /sync_stok idempotency (uncommitted)

Scope:
- `lib/models/stockMovements.js` - new optional `id_movement` param.
- `lib/sheets/syncStokDuaArah.js` - deterministic movement id, `pushed_items` marker on
  produk_baru path, re-read A2:A before append, `bacaParitasOnline` parity fix.
Read-only. No files modified.

## Verdict summary

Core idempotency mechanism is sound. Deterministic id `sync_<draftId>_<kode>` cannot collide
with other movement writes: every other caller (`permintaanGudang.js:914`, `opnameGudang.js:360`,
`chatHandler.js`, `handleScreenshotPickingList.js:117`, `handleOpname.js:272`) uses the
auto-id `.add()` branch; `id_movement` defaults to `null` so their behavior is unchanged, and
none produce a literal `sync_*` id. Verified.

No BLOCKER. Main issue is that the marker ("which items succeeded") is written as a single
batch at the very end, so the crash window between the last side effect and the marker is
wider than it needs to be - and in `applyDraftProdukBaru` that window duplicates a real
Sheets row, not just an audit row.

## Contract / caller-safety (question 7)

`catatPergerakanStok` signature is additive (`id_movement = null`). No positional params,
destructured object. All 7 existing call sites omit it -> `.add()` path -> no behavior change.
No break. Return shape `{ id, ...payload }` preserved (id from `.doc(id)` when explicit).

## Findings

### BLOCKER
None.

### IMPORTANT

**I1. `applyDraftProdukBaru` retry window duplicates a real Sheets row.**
`syncStokDuaArah.js:572` appends the row, then `:582` writes the movement, then `:599` pushes
the kode into `kodeBaruDipush`, and only at `:603-609` is `pushed_items` persisted together
with `status`. Crash anywhere between `:572` and `:603` -> retry re-enters the loop for that
kode (`:543` skip set is stale), and `values.append` with `INSERT_ROWS` cannot detect the
prior append -> **durable duplicate product row in the sheet.** The deterministic movement id
saves the audit row but not the sheet row. This is the residual window the new comment at
`:568-571` acknowledges; the comment says "hidden window not closed", but it is the more
damaging of the two apply paths (duplicate product row vs duplicate audit row), and the code
already reads `draft.pushed_items` - closing it is one line.

Recommendation: persist the marker incrementally, right after the movement write, so a retry
skips what already landed:
```
await db.collection("sync_stok_drafts").doc(draft.id)
  .update({ pushed_items: FieldValue.arrayUnion(item.kode_barang) });
```
placed after `:597`. Extra write per item (produk_baru is small, comment `:548` confirms).
Then the final `:603` update only needs `status`. Same hardening applies to I2. Do NOT reorder
to "marker first, movement after" - a crash then loses the movement permanently (silent audit
gap), strictly worse.

**I2. Non-produk_baru `applyDraft`: same marker-at-end window, lower impact.**
`syncStokDuaArah.js:497` writes each movement, `:517` writes all sheet cells in one call,
`:519-525` writes the marker. If `pushNilaiKeSheet` (`:517`) throws after N movements were
written, the marker is never persisted for those N. Retry re-writes the sheet cells (idempotent
by value) AND re-writes the N movements - but at the SAME deterministic ids (`:510`), so the
movements OVERWRITE, no duplication. This path is actually safe for the audit trail thanks to
the deterministic id. Only downside: `created_at` on those movements is refreshed to the retry
time (`stockMovements.js:70`), so a retried movement's timestamp drifts forward from the
original confirm time. Minor audit-fidelity wart, no data corruption. Incremental marker
(same fix as I1) removes it.

**I3. Retry changes `created_at` on the overwritten movement doc (deterministic id + `.set`
overwrite).** `stockMovements.js:82` `.set(payload)` replaces the whole doc, and `payload`
always contains `created_at: new Date()` (`:70`). A retry therefore mutates the original
audit timestamp rather than preserving first-write time. For an audit collection this is a
smell: the movement records "when it was last attempted", not "when it was first confirmed".
Low practical impact because `catatPergerakanStok` carries no `idempotency`/`first_seen`
field and the movement is a derived sync artifact, but worth a deliberate decision.
Recommendation if audit fidelity matters: when `id_movement` is set, use
`{ merge: true }` and conditionally include `created_at` only on create (read-before-write is
racy; simplest is a sentinel like `created_at: FieldValue.serverTimestamp()` combined with a
separate immutable `created_at_awal`). Otherwise document explicitly that retry refreshes the
timestamp. Flagging, not blocking.

### MINOR

**M1. `nomor` fallback is `""` on read failure, leaving a silently blank No cell.**
`syncStokDuaArah.js:557`. The comment at `:550` says fallback to "previous computed number",
but the catch actually sets `nomor = ""`. Behavior is intentional-ish (empty No is recoverable,
better than failing the insert) but the comment and code disagree. Also the read (`:553`) is
per-item inside the loop; for K produk_baru this is K extra Sheets reads. Fine for small K,
but the comment claims "1 read ekstra per item" (`:548`) - correct, just confirming. No action
required; reword comment or track last computed number to match the stated fallback.

**M2. `bacaParitasOnline` change is a correctness improvement, but mixes into this diff.**
`syncStokDuaArah.js:73,156,495,580`. Reading raw `stok_gudang_online` was stale after v5
migration (`qty_per_gudang.ONLINE` is canonical - confirmed `stokGudang.js:40-43`). Good fix.
Note ordering: `tandaiTersinkron` (`stok.js:125-135`) writes only `last_synced_at/ value`, not
`stok_gudang_online`, so reading `stokSebelum` at `:495`/`:580` AFTER `tandaiTersinkron` is
safe - qty delta remains correct. No issue, verified.

**M3. No guard against duplicate movement writes from concurrent draft confirmations.**
Two callers can run `konfirmasiSyncStok` on the same draft concurrently (e.g. double
Telegram callback) if `cekGuard` is false. Both write `.doc(sync_<draft>_<kode>).set()` ->
last-writer-wins, no duplicate doc, but two `pushNilaiKeSheet` batches and two append
sequences in produk_baru. `cekGuard` (`syncStokDuaArah.js:362-376`) is opt-in and off by
default in the confirm path. Since retry is now idempotent this is mostly benign, but
produk_baru concurrency can still double-append. Admin-only, low frequency; flag for
awareness, not blocking.

### NIT

**N1. `id_movement` check duplicated null+undefined test.** `stockMovements.js:79`
`if (id_movement !== null && id_movement !== undefined)`. Could be `!= null` (covers both) or
default sentinel. Cosmetic.

**N2. No log when a retry skips already-pushed items.** `syncStokDuaArah.js:482,543`. The
comment at `:474-477` explains the two-layer idempotency but nothing logs when
`sudahDipush.has()` fires, so a retry storm is invisible in prod. One
`console.warn("[sync_stok_retry] skip", draft.id, kode)`: cheap observability on exactly the
path this change is about.

**N3. `pushed_items` marker is never cleared/reconciled with `status`.** If a draft is marked
`processed` and later re-driven, `pushed_items` accumulates codes without bound (only within
one draft doc, so bounded by item count). Fine. Noted only because review question 3 asked
about collision/monotonicity - `arrayUnion` is monotonic and Set-like, so repeated pushes are
safe.

## Observability

New failure path `:556` logs read failure. Good. Missing (see N2): no log when retry skips,
no log of how many items were skipped vs processed at draft completion. `applyDraft` returns
the processed count and it is aggregated at `konfirmasiSyncStok:406` and reported to the admin
message - but that count now EXCLUDES skipped retry items, so the message "N item
disinkronkan" can read 0 on a pure retry even though the draft completed. Admin-facing
message could confuse ("0 disinkronkan" after a legit retry). Consider wording like
"N item disinkronkan (M sudah beres)".

## External call ordering

`applyDraftProdukBaru` order: append row -> `tandaiTersinkron` -> read stok -> write movement.
The sheet row is written BEFORE the Firestore markers, which is what produces I1. Movement is
written before the marker (`:582` before `:603`), consistent with I1/I2. No Firestore
transaction wraps the sequence, so it is not atomic by construction - correct to note, the
deterministic id is the chosen mitigation for movements, but no mitigation exists for the
sheet append.

## Test coverage note

`test/syncStokReplay.test.js:181-207` covers the happy retry (marker present). No test forces
a crash between sheet append and marker write for produk_baru (I1) or between `pushNilaiKeSheet`
and marker (I2). The I1 window is the one that produces a user-visible duplicate row; a
targeted test (append succeeds, marker write made to throw, retry) would lock the fix.

CHANGES_REQUIRED
