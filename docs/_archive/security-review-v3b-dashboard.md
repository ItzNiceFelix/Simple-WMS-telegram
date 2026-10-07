# Security Review - Fase B v3b (A2 Konfirmasi Draft dari Dashboard)

Scope: independent security review of the Fase B change set.
- `lib/dashboard/draftOwner.js` (NEW) - resolusi + otorisasi pemilik draft
- `lib/dashboard/draftGuard.js` (NEW) - guard dokumen `draft_kirim_guard`
- `app/api/admin/route.ts` (aksi `konfirmasi-draft`)
- `lib/dashboard/validasiTulisV3a.js` (`validasiKonfirmasiDraft`)
- `firestore.rules` (deny `draft_kirim_guard`)
- 3 handler bot: `lib/handlers/handleOpname.js`, `lib/handlers/konfirmasiPickingList.js`, `lib/sheets/syncStokDuaArah.js`

Contract baseline: `docs/dashboard-prd-v3b.md` S4, S5.4, S7, S8, S12.
Supporting read: `lib/dashboard/auth/sesi.js`, `lib/dashboard/auth/guard.js`, `lib/models/admins.js`, `test/*V3b.test.js`.

Method: read actual code only. No source modified.
`npm test` rerun: **288 pass / 0 fail**.

## Verdict

**No CRITICAL issue. One HIGH data-integrity vulnerability (real) plus one MEDIUM claim gap.**

No auth bypass found: `owner_user_id` is never read from the body; role comes from
`ambilAdmin(sesi.uid)`; owner resolution is server-side and fail-closed. The HIGH
finding is a stock double-decrement path, not an auth defect.

---

## HIGH-1 - Batch picking setengah jadi tidak di-reject; route memicu `kurangiStok` dobel

Location:
- `app/api/admin/route.ts:397-407` (picking branch - Lapis 1)
- `app/api/admin/route.ts:389` (`statusBatchPicking` declared in type block, NEVER called)
- `lib/handlers/konfirmasiPickingList.js:96-124, 126` (bot reprocesses all `movementIds`)

Evidence:

```
route.ts:399   const snap = await db.collection("stock_movements")
route.ts:399     .where("status","==","pending_confirmation").limit(100).get();
route.ts:402   const milikBatch = semua.filter((m) => draftOwner.ambilOwnerDraft(m) === v.batchId);
route.ts:403   if (milikBatch.length === 0) return 404;
```

The route's only "Lapis 1" check for picking is "does at least one movement still
exist with `status == "pending_confirmation"`". Movements already `processed` are
invisible to that query. `statusBatchPicking` - the helper that computes `"sebagian"`
- is imported only as a type declaration (`route.ts:389`) and never invoked
(grep in `route.ts`: single match, the type). The PRD-mandated message
`"Batch picking ini diproses sebagian. Selesaikan lewat Telegram."`
(`docs/dashboard-prd-v3b.md:773-780`, S8.4; E-3 at `:1177`) is absent from all
production code and all tests.

`konfirmasiPickingList` then reads the whole session batch and reprocesses everything
without a status filter:

```
konfirmasiPickingList.js:49   const pending = sessionDoc.data()?.pendingPickingList;
konfirmasiPickingList.js:54   const { chatId, movementIds } = pending;
konfirmasiPickingList.js:96   const movements = await ambilMovementsByIds(movementIds);
konfirmasiPickingList.js:101  const bisaDiproses = movements.filter((m) => m.kode_barang);
konfirmasiPickingList.js:107-112  for (...) { await kurangiStok(...); await tandaiMovementProcessed(...) }
konfirmasiPickingList.js:126  await hapusPendingPickingList(sessionRef);   // only AFTER loop
```

Attack/reachability sequence:
1. First `konfirmasi-draft` picking; the loop at `:107-124` fails mid-way
   (Firestore/transient error). Movements 1..k are `processed`, k+1..n still
   `pending_confirmation`; `pendingPickingList` is NOT deleted (`:126` not reached).
   Route catches the throw and returns 500 (`route.ts:483-487`).
2. Operator retries. Guard TTL 10s expires. Route re-queries, finds k+1..n still
   pending -> `milikBatch.length > 0` -> proceeds -> writes guard -> calls bot.
3. Bot reprocesses ALL `movementIds` including the already-`processed` ones ->
   `kurangiStok` runs again -> **stock under-counted**; `perlu_request` movements
   create duplicate `daily_requests`.

Impact: durable stock corruption (double decrement) and duplicate purchase requests
in production inventory. Not idempotent. Explicitly classified by the project's own
PRD and prior independent review (`docs/code-review.md` B-1) as a blocking defect;
still present.

Fix direction (not applied, out of reviewer scope): before writing the guard, call
`statusBatchPicking(milikBatch)`; on `"sebagian"` return 409 with the S8.4 message and
do NOT call the bot. `statusBatchPicking` already exists and is already typed in the
route.

## MEDIUM-1 - Klaim guard lintas-jalur (B2) tidak tercapai; race dashboard <-> Telegram tetap terbuka

Location: `app/api/admin/route.ts:456-482` (all three branches pass `cekGuard: false`);
`lib/handlers/handleKonfirmasiCallback.js:47,68,77`; `lib/router/routePesan.js` (no options).

The route is the only writer/reader of `draft_kirim_guard`. Every real Telegram path
calls the bot functions with no options, so `cekGuard` stays `false`
(`handleOpname.js:219-220`, `konfirmasiPickingList.js:45`, `syncStokDuaArah.js:341-342`).
Passing `cekGuard: true` from the route would be wrong too: the route just wrote the
guard, so the bot would always reject itself.

Impact: if a dashboard confirmation and a stale Telegram button press run
concurrently, both can read `pending*` before either deletes it and both apply. For
picking this is another double-`kurangiStok` path; for opname/sync duplicate audit
rows. The 10s guard only closes dashboard-vs-dashboard, not dashboard-vs-Telegram.

This is a documentation/claim gap (PRD S8.2/S8.5 assert the race is closed) with a
real data-integrity consequence, but the default (`cekGuard:false`) preserves the
prior behavior, so it is not a regression. Classified MEDIUM because the PRD
requirement is unmet.

## LOW-1 - `draft_id` / `batch_id` tidak dibatasi terhadap `/` dan karakter kontrol

Location: `lib/dashboard/validasiTulisV3a.js:214, 219`.

```
const batchId = typeof b.batch_id === "string" ? b.batch_id.trim() : "";
const draftId = typeof b.draft_id === "string" ? b.draft_id.trim() : "";
```

Only non-empty is enforced. `draftId` is passed to `db.collection(koleksi).doc(id)`
(`route.ts:410`). Firestore document ids cannot contain `/`; the Admin SDK throws and
the route maps the throw to a generic 500. No cross-collection traversal or injection
is possible (collection name is fixed server-side), so this is not a vulnerability -
but the surfaces are unconstrained and inconsistent with the A5 validator, which
explicitly rejects `/`, control chars, `.`, `..` (`validasiTulisV3a.js:146`).

## LOW-2 - Picking guard key is derived from a body-supplied value

Location: `app/api/admin/route.ts:406-407`.

```
ownerUserId = v.batchId as string;
kunci = kunciGuard("picking", ownerUserId);
```

`v.batchId` originates from the request body, but is accepted only if it equals
`ambilOwnerDraft` of at least one live `pending_confirmation` movement
(`route.ts:402`), and admin confirmation additionally requires
`String(uid) === batchId` (`draftOwner.js:41`). So it cannot target an arbitrary
session or arbitrary guard key. Bounded by server-side data; no exploit. Noted for
defense-in-depth: prefer deriving the batch owner from `movements[0]` server-side and
ignoring the body value entirely, per PRD S7.3 ("JANGAN pakai body").

## LOW-3 - Session secret fallback to bot token / empty (pre-existing, unchanged)

Location: `lib/dashboard/auth/sesi.js:11-17`.

```
return process.env.DASHBOARD_SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN || "";
```

If both env vars are unset, the HMAC key is `""` and `dat_sesi` cookies are trivially
forgeable. Not introduced by this change; no startup validation. A correct deployment
is unaffected. Recommend failing startup when `DASHBOARD_SESSION_SECRET` is absent.

## INFO-1 - Operational logs contain Telegram user ids

`console.info("[admin_konfirmasi_draft_success]"...)` (`route.ts:499`) and the
`[draft_kirim_guard_reject]` log (`route.ts:529`) record uid and the guard key
(`jenis:draftId`). These are operational metadata, not credentials; no token, secret,
stack trace, or internal path is logged. Consistent with prior reviews.

---

## Verification of required points

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | `owner_user_id` never read from body | PASS | `validasiKonfirmasiDraft` never returns it (`validasiTulisV3a.js:189-222`); route uses `dokumen` (`route.ts:418-423`). Test `draftKonfirmasiV3b.test.js:103-112` |
| 2 | Role always from `ambilAdmin(sesi.uid)` | PASS | `route.ts:82-93`; `role` from Firestore; cookie `role` ignored (`sesi.js:34-66` returns payload but route does not use it) |
| 3 | Admin only own draft; owner all; fail-closed 409 incl. owner | PASS | `draftOwner.js:35-43`; null owner -> 409 (`:37-39`); test `:129-136`, `:329-336` |
| 4 | `draft_kirim_guard` server-only + no leak | PASS | `firestore.rules:36` explicit deny before catch-all `:38`; no client read path |
| 5 | Rate limit bucket `admin:{uid}:draft` 20/min | PASS | `route.ts:74-79`; string asserted `draftKonfirmasiV3b.test.js:374` |
| 6 | Errors do not leak internals; status per S5.4 | PASS (with HIGH-1 gap) | All user errors static strings (`route.ts:416,431,437,441,486,494,496`); raw `e.message` only logged (`:485`). Picking partial-batch 409 row of S5.4 is NOT implemented |
| 7 | No injection / path traversal via `draft_id`/`batch_id` | PASS | Firestore SDK, no string-built queries; `/` -> SDK throw -> generic 500 (LOW-1) |

Additional checks:
- CSRF: `tolakOrigin` first (`route.ts:49-50`); production rejects missing Origin (`guard.js:29-42`). PASS.
- AuthN: cookie HMAC with `timingSafeEqual` + `exp` (`sesi.js:44-66`). PASS.
- Secrets: no hardcoded secrets in the change set; no secret logged. PASS.
- Tenant isolation: single-tenant app; per-draft owner check is the isolation boundary and is enforced. PASS.
- Bot backward compatibility: legacy call sites still pass string options; fallback handled (`handleOpname.js:219-220`, `syncStokDuaArah.js:341-342`; `konfirmasiPickingList.js:45` object default). PASS.

---

## Summary table

| ID | Severity | Issue | Exploitable |
|---|---|---|---|
| HIGH-1 | HIGH | Picking partial batch not fail-closed -> bot reprocesses `processed` movements -> double `kurangiStok` / duplicate `daily_requests` | Yes, retry after mid-loop failure >10s |
| MEDIUM-1 | MEDIUM | Cross-path guard never activated (`cekGuard:false` everywhere) -> dashboard <-> Telegram race open | Yes, concurrent dashboard + stale Telegram button |
| LOW-1 | LOW | `draft_id`/`batch_id` unconstrained vs `/` and control chars | No (generic 500) |
| LOW-2 | LOW | Picking guard key derived from body `batch_id` | No (must match server movement owner) |
| LOW-3 | LOW | Session secret falls back to bot token / empty (pre-existing) | No with correct config |
| INFO-1 | INFO | Logs include Telegram user ids and guard keys | No |

## Verdict: BLOCKED

HIGH-1 is a real vulnerability, not a nit: it produces durable stock corruption. It
is mandated fail-closed by PRD S8.4/E-3 and remains unimplemented. Recommend fixing
HIGH-1 (call `statusBatchPicking`, return 409 on `"sebagian"`) before merge. MEDIUM-1
should be corrected in the PRD claim or mitigated before merge; it is not an auth or
exposure defect.
