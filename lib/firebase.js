// lib/firebase.js
// Init Firebase Admin SDK (Firestore) untuk dipakai di semua Vercel functions.
// Pola singleton: cek dulu apakah app sudah pernah di-init, supaya tidak error
// "app already exists" saat function di-reuse (warm start) oleh Vercel.

const { initializeApp, getApps, cert, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function initFirebaseApp() {
  // Kalau sudah ada app yang jalan (warm start), pakai itu saja, jangan init ulang.
  const appYangSudahAda = getApps();
  if (appYangSudahAda.length > 0) {
    return appYangSudahAda[0];
  }

  // private key dari env variable biasanya berisi karakter \n literal (bukan newline asli),
  // jadi perlu di-replace dulu supaya format PEM-nya valid.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  // Prioritas: service account eksplisit dari env. Kalau tidak lengkap, fallback ke
  // Application Default Credentials (ADC) — dipakai script lokal (mis. backfill) yg
  // sudah `gcloud auth application-default login`, tanpa perlu isi .env.
  const adaServiceAccount =
    !!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!privateKey;

  if (!adaServiceAccount) {
    try {
      return initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      });
    } catch (err) {
      throw new Error(
        "Env variable Firebase belum lengkap dan ADC tidak tersedia. Isi FIREBASE_PROJECT_ID, " +
          "FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY di .env, atau jalankan " +
          "`gcloud auth application-default login`. Penyebab ADC: " +
          (err && err.message ? err.message : err)
      );
    }
  }

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

// Inisialisasi sekali saat file ini pertama kali di-require.
const firebaseApp = initFirebaseApp();
const db = getFirestore(firebaseApp);

module.exports = { db, firebaseApp };
