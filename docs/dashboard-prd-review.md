# PRD Review — Dashboard Telegram Mini App "Bot Admin Toko"

> Reviewer: adversarial senior review. Scope: `docs/dashboard-prd.md` vs actual code + Telegram spec.
> Decisions in Section 1-6 of the brief are treated as fixed; only implementation correctness/completeness judged.

---

## Verdict

**REJECT** (blocking defects present before engineering starts)

2 BLOCKER, 9 MAJOR, 9 MINOR.

Root cause of rejection: the PRD is strong on product framing but two load-bearing
requirements (atomic stock sufficiency, write idempotency) have no valid
implementation path as written, and several codebase claims do not match the code.

---

## A. Claim-by-claim verification against the codebase

Verified TRUE (good):
- `lib/models/stok.js` exports `kurangiStok`, `tambahStok`, `timpaStokOpname` and `_ubahStokRelatif` uses `db.runTransaction` (stok.js:44-85). PRD 13.3 items 1-4 broadly correct.
- `kurangiStok`/`tambahStok` use `Math.abs(qty)` (stok.js:45,49). PRD BR4 correct.
- `catatPergerakanStok` signature and auto-fill of `created_at`, `created_by_username`, `created_by_name`, `requested_by_*` via `ambilIdentitasAdmin` (stockMovements.js:11-69). PRD 13.2 correct.
- `catatPergerakanStok` accepts `created_by_username`/`created_by_name` params (stockMovements.js:27-28). PRD 13.2 optional-fill claim correct.
- `ambilAdmin` returns null, `isAdmin` = non-null, `tambahAdmin` default role guest (admins.js:8-17,48). PRD Bagian 8 note correct.
- `system_settings/ai` fields `textProvider`,`updatedAt`,`updatedBy`; `PROVIDER_VALID=["gemini","groq"]` (aiSettings.js:4-8,42-56). PRD Bagian 23/24 correct.
- `daily_requests` doc id `YYYY-MM-DD`; items `{kode_barang,nama,variasi,qty,buffer}` (dailyRequests.js:10-15,46-55). PRD 23 correct.
- `opname_drafts` / `sync_stok_drafts` both use `status:"pending_confirmation"` (handleOpname.js:178, syncStokDuaArah.js:211). PRD 15/23 correct.
- `access_requests` fields `status`,`requested_at`,`telegram_username`,`telegram_display_name`,`rejected_until`,`resolved_by/at` (accessRequests.js:17-28). PRD 23 correct.
- `admin_role_changes` fields match (adminRoleChanges.js:4-15). PRD 23 correct.
- `products` has NO top-level `nama_shopee`; shopee name is `variants[].nama_shopee` (architecture.md:100). PRD 23 note correct.
- `MAKS_LOOP_TOOL_CALL = 5` (chatHandler.js:59). PRD 1.1 item 1 correct.
- `vercel.json` only sets `maxDuration:300` for `api/*.js`; one function `api/webhook.js`. PRD Bagian 2 correct.
- `"type":"commonjs"`, Node >=20, `npm test` = `node --test test/*.test.js` (package.json). PRD Bagian 2 correct.

Claims that DO NOT match:

### A1. `stock_movements` fields/values for opname are WRONG (MAJOR)

PRD 13.2 says for mode timpa: `type:"koreksi_manual"`, `action_type:"opname"`, and lists
`action_type` values `"tambah_stok"/"kurangi_stok"/"opname"`.

Real opname path (handleOpname.js:244-259):
```
type: "opname",
action_type: "kurangi_stok", // field wajib skema ... netral
```
So real code uses `type:"opname"` and `action_type:"kurangi_stok"`, NOT
`type:"koreksi_manual"` + `action_type:"opname"`. PRD invents an `action_type:"opname"`
value that appears nowhere in the codebase. Result: audit rows from bot-opname and
dashboard-opname become indistinguishable / non-conformant, breaking S3 verification
and H4 `type` filter semantics.

Required change: either (a) PRD mirrors the real convention (`type:"opname"`,
`action_type:"kurangi_stok"`), or (b) PRD explicitly documents the new canonical
convention AND mandates a change/backfill note in `handleOpname.js`. Pick one; do not
leave both paths emitting different values.

### A2. `source` allowed values list understated (MINOR)

PRD 13.2/stockMovements comment says source `"screenshot"|"manual_chat"|"sync"`.
Reality also uses `"manual_chat_batch"`, `"manual_chat_batch_produk_baru"`,
`"manual_chat_produk_baru"` (chatHandler.js:592,610,640,967,1004) and opname emits
`"manual_chat"` (handleOpname.js:274). New value `"web_dashboard"` is fine, but PRD
Section 35 proposes an index on `source` — meaning the filter dropdown must enumerate
these real values, not the 3 documented. Align the value list.

### A3. `stock_movements.resolved_by` is in PRD 13.2 table but omitted from PRD Bagian 23 field list (MINOR). Pick one source of truth.

### A4. `created_by` type mismatch makes the "existing index" claim fragile (MAJOR)

`catatPergerakanStok` stores `created_by` as passed, no `String()` (stockMovements.js:59).
Query helper stringifies: `.where("created_by","==",String(telegramUserId))`
(stockMovements.js:84). Bot code passes numeric telegram ids. PRD FR-READ-04 assumes
"filter created_by memakai index lama" — the index exists, but equality depends on the
stored type. If numeric stored vs string client filter, the query returns 0 rows.
Required change: PRD must state the canonical `created_by` type (and require the
dashboard route to store the same type), or mandate fixing the model to always
`String()` it.

### A5. Next.js/React/Tailwind/shadcn are NOT installed (MINOR)

PRD 31 lists them as dependencies, but `package.json` dependencies are only
`@google/generative-ai`, `@vercel/functions`, `firebase-admin`, `googleapis`.
PRD must add an explicit "new client dependencies" list + version strategy, and note
the CJS/Next ESM interop risk against `"type":"commonjs"`.

---

## B. `initData` HMAC verification correctness

PRD 11.1 steps 1-6 match the Telegram spec (data_check_string = all fields except
`hash`, sorted ASCII by key, `key=value` joined `\n`; secret_key =
HMAC_SHA256(key="WebAppData", message=bot_token); computed =
HMAC_SHA256(key=secret_key, message=data_check_string) hex). No deviation in the core
scheme. Issues:

### B1. `user` JSON parsing not specified as safe (MAJOR)

PRD 11.1 step 8: "Parse `user` (JSON)". No try/catch, no schema check. Malformed JSON
throws → 500 instead of 401. E11 covers missing `user` but not invalid JSON, arrays,
or non-string `user.id` mismatch.
Required change: wrap parse; require object with numeric/string `id`; malformed → 401.

### B2. `auth_date` non-numeric / missing (MINOR)

PRD handles too-old and future, but not `auth_date` absent, `NaN`, or non-integer.
`now - NaN > 3600` is false → pass. Required: reject if not finite integer.

### B3. Comparison detail correct but underspecified for implementation (MINOR)

PRD says timingSafeEqual after equal-length check — correct (timingSafeEqual throws on
length mismatch). Add explicit requirement to compare only the hex digest and to
lowercase `hash` before comparison; also require the length check to return 401 not 500.

### B4. Freshness window vs Mini App lifetime (MAJOR, operational)

`auth_date` is fixed at Mini App launch and cannot be refreshed without reopening
Telegram. A 60-min window means an admin working >60 min gets kicked mid-task with no
silent re-auth path (initData is static). E1 says "buka ulang dari Telegram" — acceptable
but the PRD must state the session/cookie expiry interaction AND the in-app UX when the
cookie expires during a write (does the in-flight write 401? toast?). Undefined failure
behavior.

---

## C. Vercel function budget

### C1. `api/` and `app/api/` coexist, but the count is wrong (MAJOR)

Root `api/webhook.js` (Vercel Node function) and Next App Router functions coexist on
Vercel; they do not conflict structurally. But the PRD's claim "total function <= 4"
(Bagian 12, FR-ROUTES-01) ignores that a Next.js build also emits a function for every
dynamically-rendered route/server action and for middleware. If any of H1..H8 is SSR
(not static), each adds a function. The repo's `vercel.json` `functions: api/*.js`
glob does not govern `app/**`.
Required change: (a) mandate `output: "export"`/static rendering for all pages, or
count every SSR route into the budget; (b) replace the "expect <= 4" AC with an actual
`vercel build` function-count evidence step that includes Next internals + middleware.

### C2. Analytics requirement implies a 4th function (MAJOR)

PRD 27 wants `page_view`/`auth_fail`/`stock_write_*` events "boleh log server". A
client page_view cannot be "server log" without either a route or a third-party (banned).
Required: either drop client page_view, or fold event logging into existing routes.

---

## D. Security holes

### D1. Guest can read everything via client SDK — contradicts the permission matrix (MAJOR)

PRD Bagian 8.1 says guest cannot see Draft/Permintaan/Admin/Pengaturan. But Rules 11.6
grant `allow read: if admin()` to ALL of `opname_drafts`, `sync_stok_drafts`,
`daily_requests`, `admins`, `admin_role_changes`, `access_requests`, `system_settings`,
and every `admins` member (including guest) gets a custom token with `admin:true`
(PRD 11.5, 260-265). The client SDK is directly reachable, so a guest can read all of it
bypassing the hidden UI. The PRD acknowledges this at 260-265 but the matrix at 128-141
still asserts guest is denied. This is a spec contradiction, not merely a tradeoff.
Required: either (a) put `role` in the custom token and split Rules per collection
(recommended), or (b) change the matrix to state explicitly that guest has read access to
those collections. Do not ship both statements.

### D2. Role claim trusts `admins` snapshot at token issue; revocation not handled (MAJOR)

`createCustomToken(user.id, { admin:true, role })` is minted once. Firebase ID tokens
self-refresh via refresh token; a user removed from `admins` (revoked) keeps read access
for the token lifetime and potentially longer via refresh. There is no
`checkRevoked`/rule that re-checks membership.
Required: add a server re-validation on sensitive reads, short custom-token TTL, and an
explicit revocation story (or accept and document the window with a number).

### D3. Stock sufficiency check is not atomic → negative stock (BLOCKER)

PRD 13.1 step 6 checks sufficiency BEFORE calling `kurangiStok`. `_ubahStokRelatif`
(stok.js:51-67) does a transaction but NEVER validates the result is >= 0; it can write
a negative `stok_gudang_online`. Two concurrent `kurangi` requests both pass the
pre-check, both subtract. E8's claim "Transaksi runTransaction → hasil berurutan, kedua
audit tercatat" is true for serialization but does NOT prevent the negative overshoot.
FR-WRITE-02's AC is therefore unimplementable as specified.
Required change: add an atomic guarded decrement (validate inside `runTransaction`
against current value) in `lib/models/stok.js`, or add a new model function, and change
FR-WRITE-02 evidence to a concurrency test. Pre-check alone is insufficient.

### D4. Idempotency (`client_request_id`) has no storage defined (BLOCKER)

FR-WRITE-08 requires dedup of two requests with the same id within 5 minutes, with the
second returning `{ok:true,duplikat:true}` and stock changing once. The PRD names no
collection, no key field, no TTL, and no cleanup. Firestore Rules (11.6) and Bagian 23
define no such collection. As written it cannot be implemented or verified.
Required: define storage (e.g. new server-only collection `idempotency_keys` keyed by
`client_request_id`, with `kode_barang`, `movement_id`, `created_at`, TTL/cleanup), and
add it to the Rules catch-all (client write denied) and to Bagian 23.

### D5. No rate limits on write/auth routes (MINOR)

`/api/stok/mutasi` has no per-user rate limit; idempotency only covers identical
`client_request_id`. `/api/auth/telegram` has no attempt cap. HMAC brute force is
infeasible, but write spam and audit flooding are not. Bot already has
`lib/gemini/rateLimit.js` as a pattern. Add at least a simple per-user write limiter.

### D6. CSRF/cookie/iframe (MINOR)

`SameSite=Lax` + POST blocks classic cross-site form CSRF, but Telegram Web/WebView can
embed the app in a cross-origin iframe in some clients, where third-party-cookie
restrictions apply. No CSRF token is specified. Requirement should state the concrete
embedding assumption and add an origin/CSRF check on state-changing routes.

### D7. Browser cannot write stock — confirmed safe (GOOD)

Rules 11.6 set `allow write: if false` for `stock`/`stock_movements`; admin SDK bypasses.
PRD 13.3 correctly forbids client writes. No bypass path found in the described design.

---

## E. Untestable or missing requirements

### E1. FR-NFR-01 "no English strings" is not mechanizable (MINOR). Define an allowlist of proper nouns/technical terms, else the AC is subjective.

### E2. S2/FR-READ H1 timing depends on full-collection client reads (MAJOR)

"item di bawah reorder point" and H2 "menipis" filter require
`stok_gudang_online < reorder_point`, which Firestore cannot express (stok.js:6-11). The
dashboard must read the ENTIRE `stock` collection (plus `products` for the join) into the
client and filter in memory. PRD never acknowledges this; S2 (<=2.5s P75) and FR-READ-02
are unproven and likely false at catalog scale (katalog bisa ribuan produk per
produk.js:33-36).
Required: state the full-scan cost, cap scope (e.g. only `is_online_product==true`
products + their stock), and add a measurable data-size assumption to S2.

### E3. E6 contradicts the mode rules (MINOR)

E6 lists `0` as invalid, but 13.1 step 3 allows `qty >= 0` for timpa. Message
"Jumlah harus bilangan bulat >= 1" is wrong for timpa. Split the validation message per mode.

### E4. E8 concurrency AC is not a verifiable test (MAJOR, ties to D3). Rewrite as a two-writer test asserting final stock >= 0 and two audit rows.

### E5. FR-WRITE-08 response schema contradicts Bagian 24 (MINOR). Bagian 24 omits `duplikat:true`.

### E6. E12 "audit ditulis setelah stok sukses; jika audit gagal ... tidak rollback" mirrors chatHandler.js:1016-1026 (GOOD), but there is no alert/visibility. Add monitoring hook (Bagian 34 mentions logs only).

### E7. Missing edge cases: cookie expired mid-write; `user.id` numeric vs string; `reorder_point == 0` (should item with 0 reorder and stock 0 be "menipis"? PRD uses `!= null` and `<`, so 0<0 false — fine, but state it); negative stored stock already present; products doc exists but `stock` doc missing (join behavior).

### E8. FR-WRITE-09 AI provider: PRD doesn't enumerate `gemini|groq` valid values (MINOR). Client can submit arbitrary; route must reject invalid (aiSettings.js:44 already does — state it).

---

## F. Firestore indexes

Existing (`firestore.indexes.json:1-21`): `stock_movements (created_by ASC, created_at DESC)`
and `(kode_barang ASC, created_at DESC)`. PRD Section 35 proposal:

1. `type ASC + created_at DESC` — NEEDED for H4 type filter. OK.
2. `status ASC + created_at DESC` — NEEDED for H4 status filter. OK.
3. `source ASC + created_at DESC` — REDUNDANT. H4 filter list (PRD 395) does not include `source`. Drop unless source filter is added.
4. `kode_barang ASC + type ASC + created_at DESC` — REDUNDANT unless H3 actually supports a combined kode+type filter. FR-READ-03 query is `kode_barang == X orderBy created_at desc`, already covered by existing index #2. Drop or add the H3 type filter explicitly to Bagian 15.
5. `admin_role_changes created_at DESC` — single-field, auto-indexed; composite not needed.
6. `opname_drafts status ASC + created_at DESC` — single-field status + created_at DESC in one query: Firestore needs composite only if filtering equality + orderBy on a different field. `status` equality + `orderBy(created_at)` DOES require a composite. NEEDED.
7. `sync_stok_drafts status ASC + created_at DESC` — NEEDED, same reason.
8. `daily_requests status ASC + created_at DESC` — MOSTLY REDUNDANT. H6 "hari ini + riwayat" is doc-id based (`YYYY-MM-DD`), not a status-filtered collection scan. Drop unless a status query is specified.
9. `access_requests status ASC + requested_at DESC` — NEEDED only if H7 filters by status. Bagian 15 H7 does not specify a filter. Add the filter to H7 or drop the index.

Also MISSING: if H4 filters `type` and `status` together, or `created_by` + `type`, additional composites are needed. PRD must enumerate the exact filter combinations so index count is bounded (Firestore composite index sprawl + Hobby query limits).

Required change: PRD must define the exact query for each filter (fields + equality/range + orderBy) and derive indexes from that, not infer them.

---

## G. What the PRD got right

- Auth architecture is sound: server-side HMAC verify, HttpOnly cookie, no client-trusted
  role, browser-only access explicitly out of scope (Bagian 7 N1, 11.3).
- The HMAC scheme itself matches the Telegram spec exactly; constant-time comparison is
  required; length check noted.
- Stock writes correctly forced through `lib/models/stok.js` + `stock_movements` audit,
  with the correct rationale (cache invalidation, reorder notification, transaction —
  13.3). Client write correctly forbidden.
- Value of new `source:"web_dashboard"` is scoped to one new value only.
- Function-limit constraint is explicitly recognized, with a route-minimization rule.
- Non-goals are sharp and prevent scope creep (no Firebase Auth login, no AI, no CRUD,
  no multi-outlet).
- Edge/empty/loading/error states are enumerated per page (Bagian 20, 21), which many
  PRDs omit.
- Acceptance criteria numbering exists and is referenced from DoD.
- Security Rules draft is deny-by-default with a catch-all deny (252), and includes the
  explicit warning against `request.auth != null`-only reads.

---

## Ordering of required fixes before approval

1. Fix D3 (atomic guard) and D4 (idempotency store) — both blockers.
2. Resolve A1 (opname type/action_type) and D1/D2 (guest read + revocation) — these
   change the security and audit model.
3. Fix C1/C2 (function count method + analytics) and E2 (full-scan reality) — these
   affect feasibility of stated NFRs.
4. Clean up F (indexes) and A4 (`created_by` type) — schema/test correctness.
5. Address remaining MINOR items.

---

## Status

REJECTED