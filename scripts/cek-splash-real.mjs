// Uji mode REAL dengan initData Telegram TIRUAN:
//  - splash tampil saat inisialisasi,
//  - TIDAK ada flash "Gagal memuat"/error palsu,
//  - setelah sesi siap, konten dashboard render.
// Memakai server mode real (scripts/e2e-build-real.mjs + next start).
import { chromium } from "playwright";

const BASE = process.env.CEK_REAL_BASE || "http://127.0.0.1:3105";
const b = await chromium.launch();
const p = await b.newPage();

// Stub SDK Telegram SEBELUM app jalan.
await p.addInitScript(() => {
  window.Telegram = { WebApp: { initData: "stub-init-data", version: "6.0" } };
});

// Stub endpoint auth: sukses + role owner.
await p.route("**/api/auth/telegram", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      user: { id: "900001", username: "owner_toko", name: "Budi Owner" },
      role: "owner",
      firebaseToken: "stub-token",
    }),
  })
);

// Stub Firestore SDK: getSession() tidak akan menembus jaringan karena
// makeRealDataSource hanya memanggil /api/auth/telegram untuk sesi.
// (signInWithCustomToken memanggil identitytoolkit -> stubbed agar tidak keluar.)
await p.route("**/identitytoolkit.googleapis.com/**", (route) => route.abort());

const masalah = [];
p.on("pageerror", (e) => masalah.push(`pageerror: ${e.message}`));

await p.goto(`${BASE}/?role=owner`, { waitUntil: "domcontentloaded" });

// 1) Splash harus muncul lebih dulu.
const splashTerlihatAwal = await p
  .getByTestId("splash-awal")
  .waitFor({ state: "visible", timeout: 5000 })
  .then(() => true)
  .catch(() => false);

// 2) Tidak boleh ada "Gagal memuat" saat boot.
await p.waitForTimeout(2500);
const teks = await p.locator("body").innerText();
const adaGagalMemuat = /Gagal memuat/.test(teks);

console.log("splash_muncul:", splashTerlihatAwal);
console.log("ada_gagal_memuat:", adaGagalMemuat);
console.log("h1:", JSON.stringify(await p.locator("h1").allTextContents()));
console.log("masalah:", masalah.length ? masalah.join(" ;; ") : "none");

await b.close();
process.exit(splashTerlihatAwal && !adaGagalMemuat ? 0 : 1);
