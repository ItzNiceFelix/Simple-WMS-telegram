# Security Review — Dashboard v3a (independent)

Scope: NEW/CHANGED attack surface only. Uncommitted work reviewed:
`app/api/permintaan/route.ts`, `app/api/admin/route.ts`,
`lib/dashboard/validasiTulisV3a.js`, `lib/models/dailyRequests.js`,
`lib/models/keywordNotes.js`, `lib/telegram/kirimPesan.js`,
`lib/dashboard/data/{real,mock,normalisasi}.ts`, `firestore.rules`.

Method: read actual source only. **No code modified. No node process killed.**

## Verdict

**PASS WITH CHANGES** — no exploitable unauthenticated bypass found. All new
server mutations require a verified HMAC session + role read from Firestore,
and `tolakOrigin` runs before any side effect (including Telegram). Outstanding
items are defensive-in-depth / amplification / audit-retention concerns.

---

## Blocking

None.

---

## Non-blocking

### NB-1 — Authenticated Telegram amplification ("kirim ulang" has no per-date dedupe)
- Location: `app/api/permintaan/route.ts:153-191`, `lib/models/dailyRequests.js:392-418`.
- Skenario: staff valid (owner/admin, any role able to call `sesuaikan`) posts
  `{"aksi":"buat-form","tanggal":"<hari-ini>","..."}`. First call sets status
  `diproses` and broadcasts to every owner+admin. The idempotency short-circuit
  (line 158) only fires when `status==="diproses" && age<30s && form_dibuat_by===sesi.uid`.
  After 30s, or from a *different* uid, the same body re-runs `buatForm` +
  `kirimFormPermintaan`. Route rate limit is 30/min/uid (line 58), and the send
  fan-out is `N` admins. Result: up to 30 x N Telegram messages per minute per
  staff account, with content controlled through `qty` (via `sesuaikan`) and
  product names from Firestore.
- Dampak: notification spam / Telegram rate-limit abuse, not privilege escalation
  or data breach. Content is server data; no parse_mode (plain), no header
  injection, no SSRF (fixed host `api.telegram.org`).
- Perbaikan: add a server-side per-date send guard (e.g. store `last_form_sent_at`
  + refuse re-broadcast within N minutes regardless of uid, or require an explicit
  `kirim_ulang:true` flag with its own tighter rate limit). Confirm with product
  whether silent re-send is intended.

### NB-2 — Audit retention `perubahan[]` capped at 50 → eviction of history
- Location: `lib/models/dailyRequests.js:214` (`perubahan.slice(-MAKS_PERUBAHAN)`).
- Skenario: staff with `sesuaikan` permission on today's request submits 51+
  single-item qty changes in one or more requests; oldest audit entries are
  dropped. Mutations themselves cannot occur without an entry (`perubahan.push`
  is unconditional per changed item, line 191), so there is no "change with zero
  audit" path — but history *can* be deliberately aged out.
- Dampak: tamper-by-flooding of the change trail. Requires an already-trusted
  staff role. Documented B5/PRD behaviour.
- Perbaikan: if full history needed, append to a separate immutable
  `daily_requests/{tgl}/perubahan` subcollection (or BigQuery/export) instead of
  capping an array. Otherwise accept as documented limit.

### NB-3 — In-memory rate limit is per-instance and not shared
- Location: `lib/dashboard/auth/guard.js:44-71`.
- `cekRateLimit` uses a process-local `Map`. On Vercel/serverless with multiple
  concurrent instances the effective limit is `limit x instances`, and cold
  starts reset the window. Mitigating: every new write route already requires a
  valid HMAC session, and `kata-kunci` is owner-only, so this is a soft abuse
  control not an auth control.
- Dampak: amplification of NB-1; minor.
- Perbaikan: move to a shared store (Firestore transaction counter / Upstash)
  if abuse becomes real. Also note the map is unbounded → slow memory growth
  under many distinct uids (low risk given auth requirement).

### NB-4 — `datang` / `selesai` / `buat-form` accept past dates
- Location: `lib/dashboard/validasiTulisV3a.js:46-49` (only *future* rejected),
  `52-56` (`sesuaikan` restricted to today only).
- Skenario: staff can mark items arrived / complete / re-broadcast a form for any
  existing past `daily_requests` doc (status not `selesai`). Chain:
  `tanggal:"2026-01-01"`, `aksi:"datang"` → writes `datang_at/datang_by`, may set
  `status:"selesai"` and `selesai_at/selesai_by`.
- Dampak: retrospective edits to old documents. Each mutation still writes
  `*_by` / `*_at` audit fields (lines 290-308, 333-338), and a `selesai` doc is
  then locked (409, route line 122). No zero-audit mutation identified → limited.
- Perbaikan: if historical back-dating is not a product requirement, restrict
  `datang`/`selesai`/`buat-form` to today (or a bounded window), matching
  `sesuaikan`. Needs product decision.

---

## Catatan

- **C-1** `firestore.rules` gained a UTF-8 BOM (`EF BB BF`, bytes 0-2). Rules
  loader may reject BOM on deploy. Verify `firebase deploy --only firestore:rules`
  before release. Not a runtime vulnerability; deployment/availability risk.
- **C-2** `tolakOrigin` rejects requests without an `Origin` header in production
  (`guard.js:31-37`). Telegram Mini App WebViews normally send `Origin`; verify
  in the real client, otherwise legitimate writes fail (availability, not security).
- **C-3** `DASHBOARD_SESSION_SECRET` falls back to `TELEGRAM_BOT_TOKEN`
  (`sesi.js:11-17`). Acceptable but couples two secrets: rotating the bot token
  invalidates all sessions. Documented in `.env.example`. Prefer explicit secret.
- **C-4** `role` is read from Firestore `admins` on every mutation; the HMAC
  payload `role` claim is never trusted (`permintaan/route.ts:80-95`,
  `admin/route.ts:62-77`). Correct. Stale sessions are therefore safe: a demoted
  admin loses write access on the next request.
- **C-5** `.vercel/.env.preview.local` exists on disk but is git-ignored and not
  tracked (`git ls-files` confirms). `.env.example` is committed with empty
  values only. No hardcoded secrets found in changed files.
- **C-6** `kata-kunci` `id` is used directly as a Firestore doc id
  (`keywordNotes.js:143`). `/` would throw (invalid path), but the thrown error is
  caught by the route and mapped to a generic 500 — no traversal, no path escape
  beyond the `keyword_notes` collection.

---

## Pemeriksaan yang lulus

1. **Authorization server-side, not UI.** `kata-kunci` requires
   `role === "owner"` after reading `admins/{sesi.uid}` (`admin/route.ts:63-77`);
   admin/guest get 403. Same for `/api/permintaan` (owner/admin only,
   lines 80-95). Role never read from body or session claim. `ButuhAkses` is
   explicitly documented as non-security.
2. **Doc-id traversal blocked.** `validasiTanggal` enforces
   `^\d{4}-\d{2}-\d{2}$` plus a real-calendar check (`validasiTulisV3a.js:36-50`).
   `/`, `..`, `__proto__`, and out-of-range years (e.g. `0050`) cannot reach
   `db.collection(...).doc(...)`. All four actions route through this validator.
3. **Input validation on write boundaries.** `qty`/`qty_datang` must be
   integers 0..1_000_000 (`validasiTulisV3a.js:20-32`); `kode_barang` must be a
   non-empty string; `variasi`/`buffer` are normalised/coerced; `aksi` and
   `interpreted_as` are allowlisted (`9`, `13`, `122-140`). String vs number is
   rejected (`typeof` checks), no implicit coercion of attacker input into
   Firestore numbers.
4. **No string-built SQL/queries.** Firestore SDK `doc(id)`/`where()` only; no
   query string interpolation. `keywordNotes.cariKeywordNote` uses a `==` filter
   param, not concatenation.
5. **CSRF / origin before side effects.** `tolakOrigin` is the first statement in
   both routes (`permintaan/route.ts:49`, `admin/route.ts:32`), before session
   check, rate limit, Firestore, and Telegram. `kirimTulis` uses
   `credentials:"include"` with no custom auth header, so origin allowlist +
   `SameSite=Lax` cookie is the CSRF boundary. Production requests without
   `Origin` are rejected.
6. **Session integrity.** HMAC-SHA256 over base64url payload with
   `crypto.timingSafeEqual`, `exp` enforced (`sesi.js:49-63`); cookie `HttpOnly;
   Secure; SameSite=Lax`. Session uid is the only identity used; role claim
   ignored.
7. **Telegram send hardening.** `kirimPesanPlain` omits `parse_mode`
   (`kirimPesan.js:85-91`) → no Markdown/entity injection from product names.
   Chat id comes from `admins.telegram_user_id`, never from request body
   (`dailyRequests.js:399-404`). Deduped by chat id. No new SSRF (fixed
   `https://api.telegram.org` host, token/target not attacker-influenced).
8. **No sensitive data in user-facing errors.** Model errors map to a fixed table
   (`permintaan/route.ts:38-46`, `221-227`); everything else becomes a generic
   500. Server logs record `uid`, `alasan`, and `String(e)` — no tokens, cookies,
   or private keys. `panggilTelegramApi` logs `data.description` only, not the
   URL/token.
9. **Rules default-deny holds.** `firestore.rules` keeps `allow write: if false`
   on all collections; new `permintaan_form_guard` is server-only
   (`allow read, write: if false`), covering the new guard collection.
   `keyword_notes` stays read-for-staff / write-false. Client `real.ts`
   `listKeywordNotes` is a read-only `getDocs` and is gated by `staff()` rules.
10. **Guard TOCTOU handled.** `periksaGuardForm` uses `runTransaction`
    (`permintaan/route.ts:241-273`), so concurrent double-tap cannot both pass;
    the 10s window is a best-effort UX guard and failing it does not block the
    legitimate action.
11. **No XSS in changed UI.** `app/permintaan/page.tsx`,
    `dialog-ubah-jumlah.tsx`, `dialog-barang-datang.tsx`, `kata-kunci/page.tsx`
    contain no `dangerouslySetInnerHTML`/`innerHTML`/`eval`. React escapes all
    rendered Firestore strings.

---

## Tidak bisa diverifikasi tanpa lingkungan nyata

- Vercel production: whether `DASHBOARD_ALLOWED_ORIGINS` is set and matches the
  Telegram Mini App origin, whether `NODE_ENV=production` (no-Origin requests
  then correctly 403), and whether rate limits behave across concurrent
  serverless instances (NB-3).
- Firestore: live rules deployment accepts/ignores the BOM (C-1); actual
  `admins` role data; whether any `daily_requests` doc has out-of-schema items.
- Telegram: true fan-out size (`N` owners+admins), per-bot send limits, and
  whether the Mini App WebView emits `Origin`.
- GitHub/Vercel secret config: `.env.example` is empty and no secrets are in the
  repo, but I cannot confirm no secret was pasted into Vercel env UI.

---

## Pre-commit checklist

- [x] No hardcoded secrets in changed files (env/secret-manager only, validated
      at use).
- [x] User input validated at boundaries (allowlist actions, integer qty,
      strict date/doc-id format).
- [x] No string-built SQL; Firestore parameterised queries only.
- [x] React output encoding on all changed UI; no raw HTML.
- [x] CSRF: origin allowlist + `SameSite=Lax` + `HttpOnly`; `tolakOrigin` before
      side effects.
- [x] AuthN/AuthZ enforced on changed paths; role from Firestore, owner-only
      enforced server-side for `kata-kunci`.
- [~] Rate limiting present (30/min permintaan, 20/min admin) but soft/per-instance.
- [x] Error messages do not leak stack traces, paths, or secrets.

PASS
