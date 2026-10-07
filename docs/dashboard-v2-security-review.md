# Dashboard v2 - Independent Security Review

Date: 2026-09-15
Reviewer: independent application security review (read-only, no source modified)
Scope: **new/changed attack surface only** - 5 new write routes + changed model/auth/rules. Whole-repo review NOT performed.

Commands used: `git status`, `git diff`, `git diff --stat`, `git ls-files`, direct reads of new/untracked files.
No `kill`/`taskkill`/`Stop-Process` executed.

---

## Verdict

**PASS WITH CHANGES**

No CRITICAL or BLOCKING finding. No secret exposure, no auth/authorization bypass, no
injection, no cross-collection path traversal found. Diff contains defense-in-depth gaps
and correctness/audit-integrity notes that should be fixed before/soon after ship, but
none is exploitable with a concrete payload in the reviewed code.

---

## Blocking

None.

---

## Non-blocking

### N-1. `setReorderPoint` returning `null` is not handled - false success + audit row for a change that did not happen
Location: `app/api/stok/reorder-point/route.ts:113-142`, `lib/models/stok.js:152-176`

`setReorderPoint` returns `null` when the stock doc is absent at write time
(`stok.js:153-154`). The route already pre-read `stokLama` (`route.ts:99-106`) but does
NOT check `hasil === null` after the model call. It proceeds with `hasil ? ... : false`,
then writes a `product_changes` audit row and returns `{ ok: true, ... }`.

Concrete scenario (race, narrow):
1. `stokLama = await ambilStok(kode)` returns a doc.
2. Between that read and `setReorderPoint`, the `stock/{kode}` doc is deleted (e.g.
   cleanup/migration job, or another operator).
3. `setReorderPoint` finds no doc, returns `null`; no write occurs.
4. Route still writes audit `field:"reorder_point"`, `nilaiBaru:<value>` and returns
   `200 { ok: true }`.

Impact: audit trail records a mutation that never happened; caller believes it succeeded.
Not a privilege escalation. Requires an external delete of the same doc in a tiny window,
so not practically exploitable by an attacker alone.

Fix: after `hasil`, `if (!hasil) return json({ ok:false, error:"Data stok produk belum ada." }, 404);`
before writing audit. (Or have the model return a discriminated result and branch on it.)

### N-2. Owner-last guard is read-then-write (TOCTOU) - 0 owner reachable under concurrency
Location: `lib/models/admins.js:89-92` (role demotion), `app/api/admin/hapus/route.ts:92-114` (delete)

Both paths: read owner count -> decide -> mutate, with no transaction.
Two concurrent `owner -> admin` role changes (or two concurrent deletes of owners) can
both observe `owners.length > 1` and both commit, yielding 0 owners.

Impact: lockout from dashboard-admin operations. Recovery still possible only if
`SUPER_ADMIN_ID` env is set AND that account is also `owner` in Firestore (see N-4).
This is explicitly accepted in PRD §16.2 E1 / R3.

Fix (defense-in-depth): wrap owner-count + update/delete in `db.runTransaction`, or
write a `stock_write_guard`-style sentinel doc. Low urgency given rate limit + audit.

### N-3. Auth rate limit key derived from a client-controllable header
Location: `app/api/auth/telegram/route.ts:39-43,52`

`ipDari()` returns `x-forwarded-for.split(",")[0].trim()` - the leftmost entry is
attacker-influenced if any proxy in front of the app appends rather than overwrites.
An attacker can vary the header to get a fresh `auth:{ip}` bucket per request, defeating
the 30/min limit.

Impact: rate limit only. HMAC `initData` verification still gates real auth, and the
other 4 write routes key on verified `sesi.uid` (not spoofable). Low.

Fix: key on a platform-provided trusted IP header (Vercel: `x-real-ip` / `x-vercel-forwarded-for`),
or key auth by `initData` hash/id after parse.

### N-4. `SUPER_ADMIN_ID` is NOT an authorization source on dashboard routes - "recovery net" claim inaccurate
Location: `app/api/auth/telegram/route.ts:98`, all 5 routes' `ambilAdmin(sesi.uid)` role check

Routes authorize strictly from `admins/{uid}.role` in Firestore. `isSuperAdminDariEnv`
is only used for a UI flag (`superAdmin`) and as a delete guard. Consequences:
- An env super admin with NO Firestore `admins` doc gets `403` at `ambilAdmin` -> cannot
  use any dashboard write route.
- An env super admin whose Firestore role was demoted loses all route access even though
  `superAdmin: true` is returned.
- If Firestore ends at 0 owners, the env account cannot bootstrap from the dashboard.

Not an escalation (nothing grants extra rights), but the documented recovery path
(PRD §R3/E1 "`SUPER_ADMIN_ID` env sebagai jaring pemulihan") does not hold for dashboard
routes as implemented. Confirm the intended recovery is bot-only, or make routes treat
`isSuperAdminDariEnv(sesi.uid)` as owner.

### N-5. `kode_barang` is not format-restricted; used directly as a Firestore document id
Location: `lib/dashboard/validasiTulisV2.js:20-21,53-54`, `lib/models/produk.js:71-96`, `lib/models/stok.js:152`

Only "non-empty trimmed string" is enforced. Values with `/` create NESTED paths, e.g.
`kode_barang = "a/b"` -> `products/a/b` and `stock/a/b`.

Verified NOT a cross-collection path traversal: Firestore treats the extra segments as a
subcollection under the named collection, so writes stay inside `products/` or `stock/`.
No arbitrary-collection write is reachable. Wildcard `../` also does not escape a named
collection root.

Residual risk: unexpected nested docs, or `500` on invalid ids (e.g. leading `/`), and
audit rows keyed by a non-product code. Informational-to-low.

Fix: add a `kode_barang` format whitelist (e.g. `^[A-Za-z0-9._-]{1,64}$`) to reject `/`.

### N-6. `lib/firebase.js` now silently falls back to Application Default Credentials
Location: `lib/firebase.js` (changed): incomplete `FIREBASE_*` env -> `applicationDefault()`

On a host that has ambient ADC (GCP/GCE/Cloud Run), an incomplete env config no longer
fails fast; the app authenticates as whatever the platform identity is (possibly a
broader service account). On Vercel ADC is absent -> the catch rethrows with the ADC
error message. The message is server-side only (not returned to clients).

Not a new client-facing leak, but it changes the failure mode from "loud config error" to
"works as a different identity", which can mask misconfiguration.

Fix: gate the ADC fallback behind an explicit opt-in env (e.g. `FIREBASE_USE_ADC=true`)
so production always fails closed on missing service-account env.

### N-7. Audit-failure semantics allow a committed write with no audit row (accepted design)
Location: `app/api/produk/hpp/route.ts:115-141`, `app/api/stok/reorder-point/route.ts:123-136`,
`app/api/admin/tambah/route.ts:112-125`, `app/api/admin/hapus/route.ts:130-143`,
`lib/models/admins.js:104-121`

On audit write failure the mutation is NOT rolled back; response is `200` +
`peringatan_audit: true`. This is intentional (PRD §4.3/E2/E3) and consistently
implemented. Flagging as residual risk: an attacker who can degrade the audit collection
(e.g. quota exhaustion) can create unaudited writes while the API reports them as
"audited-with-warning".

Fix (optional hardening): alarm on `[audit_write_failed]` occurrence; consider a
transactional `stock_write_guard` sentinel for high-value changes.

### N-8. `updateRoleAdmin(..., { catatAudit:false })` escape hatch
Location: `lib/models/admins.js:79,105`

Any future caller can disable audit. Currently no caller in the reviewed diff passes
`false` (verified: only `test/auditRole.test.js:86` uses it). Keep it test-only; avoid
exposing it through any route/model wrapper.

---

## Notes

- **Env super admin vs role guard asymmetry:** `hapus` protects the env super admin from
  deletion (`validasiTulisV2.js:128-130`), but the role route/`updateRoleAdmin` does NOT
  protect them from demotion. An owner can set an env super admin to `guest`. Combined
  with N-4, this removes the recovery account's dashboard capability. Not escalation,
  but worth aligning with §R7 intent.
- **`product_changes` read by nobody in v2** (PRD Q4 defers UI). Rule grants `staff()`
  read; harmless but the collection grows unbounded (no TTL/retention).
- **`console.info` success logs** echo uid/target/kode/role - operational metadata, no
  secrets. `console.error` strings include `String(e)` (may embed Firestore internals),
  but these are server logs only and never returned in HTTP bodies.
- **`tambahAdmin` may create `role:"owner"` and `tambahAdmin` uses `set()` without merge.**
  Route pre-checks existence (`route.ts:95-102`) to avoid clobbering, but that check is
  also read-then-write; a concurrent duplicate `tambah` for the same id could still
  overwrite (last-write-wins) with no privilege change. Intended per PRD.
- **`firestore.rules` coverage checked:** every collection written by new code has a rule
  and `allow write: if false`: `product_changes` (new), `admin_role_changes`,
  `access_requests`, `admins`, `stock`. No new collection was left uncovered.

---

## Checks that PASSED (verified, not assumed)

- **No hardcoded secrets.** Grepped for tokens/keys/passwords across changed files; all
  credentials come from env (`TELEGRAM_BOT_TOKEN`, `DASHBOARD_SESSION_SECRET`,
  `SUPER_ADMIN_ID`, `FIREBASE_*`, `NEXT_PUBLIC_*`). `.env` / `.env.local` not present
  in tree. `.env.example` contains names only, no values.
- **Auth enforced on every new route, role from Firestore.** All 5 routes resolve the
  actor via `ambilAdmin(sesi.uid)` and read `role` from the returned doc, never from
  body/header/session-claim. Verified line-by-line:
  hpp `route.ts:62-77`, reorder `:58-73`, role `:73-85`, tambah `:64-80`, hapus `:78-90`.
- **Authorization matrix matches PRD.** HPP = owner only; reorder = owner+admin
  (guest rejected); role/tambah/hapus = owner only. Verified by reading the `!==`/`===`
  role branches.
- **Session handling.** Cookie is HMAC-signed; `verifikasiTokenSesi` uses
  `timingSafeEqual`, rejects non-integer `exp` and expiry; `ambilTokenDariCookie` exact
  name match. Write routes ignore session `role` entirely.
- **`tolakOrigin` first on all routes.** It is the first statement in each POST handler,
  before body parse, auth, or any mutation - no side effect precedes it. Fails closed in
  production when allowlist is empty or Origin is missing.
- **CSRF posture.** HttpOnly + Secure + `SameSite=Lax` cookie, global origin allowlist,
  no state-changing GET. Adequate for a Telegram Mini App.
- **Rate limiting present on all 5 routes**, keyed by verified `sesi.uid`
  (`hpp:20`, `reorder:20`, `adminrole:10`, `admintambah:10`, `adminhapus:10`). Keys not
  forgeable from the body (see N-3 for the auth route only).
- **Input validation at the boundary.** `validasiTulisV2.js` enforces: integer-only
  numbers (string `"90000"` rejected by `typeof !== "number"`), `>= 0`, `null` only where
  specified, digit-only ids (`^\d+$`), role allowlist, name length, `@`/whitespace
  rejection in username. Body parse wrapped in try/catch -> 400.
- **No injection.** No string-built SQL; Firestore SDK field/value API only. No
  `eval`/`new Function`/`innerHTML`/`dangerouslySetInnerHTML` in changed/new files.
- **Self-change and owner-last guards present** in `updateRoleAdmin`
  (`admins.js:82-92`); self-delete and owner-last in `alasanTolakHapus`
  (`validasiTulisV2.js:117-131`). String comparison on validated digit ids, so
  number-vs-string id bypass is not reachable.
- **Audit is emitted for every successful mutation path** (one row per changed field for
  HPP; one for reorder; one in model for role change; one for add; one for delete), and
  audit rows are written only after the mutation commits. Bot double-audit removed
  (`handleSetRole.js` no longer calls `catatPerubahanRole`).
- **Error messages returned to users are generic** ("Gagal memperbarui HPP.", etc.) - no
  stack traces, file paths, collection names, or internal ids in HTTP responses.
- **No sensitive logging:** no initData, cookie, custom token, or secret is logged.
- **UI role defaults do not leak write ability in real mode.** Shell holds content while
  `statusAuth === "memuat"` (`app-shell.tsx:20`, `sumber-data.tsx:173-189`), and the
  server re-checks role regardless of UI state.

---

## Cannot be verified without a real Vercel/Firestore environment

- In-memory `cekRateLimit` effectiveness across multiple serverless instances (per-instance
  Map, not shared) - bypassable by hitting different warm instances.
- Exact Firestore `.doc()` behavior for malformed ids at runtime (reasoned from SDK
  path semantics, not executed against a live project).
- Actual env configuration in production: whether `DASHBOARD_ALLOWED_ORIGINS` is set,
  whether `DASHBOARD_SESSION_SECRET` is set vs falling back to the bot token, and whether
  `SUPER_ADMIN_ID` points at an account that also exists as Firestore `owner` (N-4).
- Whether ADC is available on the deploy target (`lib/firebase.js` fallback path, N-6).
- Firestore Security Rules deployment state (rules file read; not tested via emulator or
  live rule simulation).
- Behavior under real concurrency for the owner-last TOCTOU (N-2).

PASS WITH CHANGES
