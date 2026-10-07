"use client";

// lib/dashboard/data/klien-firebase.ts
// Init Firebase client SDK (modular). Config publik via NEXT_PUBLIC_FIREBASE_*.
// Login memakai custom token dari /api/auth/telegram (PRD 11.5).
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithCustomToken, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function pastikanConfig() {
  if (!config.apiKey || !config.projectId) {
    throw new Error(
      "Konfigurasi Firebase client belum lengkap (NEXT_PUBLIC_FIREBASE_*)."
    );
  }
}

export function ambilApp(): FirebaseApp {
  pastikanConfig();
  if (!app) {
    app = getApps()[0] ?? initializeApp(config);
  }
  return app;
}

export function ambilAuth(): Auth {
  if (!auth) auth = getAuth(ambilApp());
  return auth;
}

export function ambilDb(): Firestore {
  if (!db) db = getFirestore(ambilApp());
  return db;
}

/**
 * Login dengan custom token segar dari server.
 *
 * JANGAN skip saat `currentUser` sudah ada: sesi Firebase lama yang di-restore dari
 * IndexedDB bisa memakai token kedaluwarsa / tanpa claim `role`, sehingga Security Rules
 * menolak SEMUA read dan halaman menampilkan "Coba lagi" walau auth HTTP-nya sukses.
 * Server membuat custom token baru setiap boot (`/api/auth/telegram`), jadi login ulang
 * selalu murah dan benar. Bila uid berbeda, sesi lama WAJIB diganti (signOut dulu).
 */
export async function masukDenganCustomToken(token: string): Promise<void> {
  const a = ambilAuth();
  const uidBaru = bacaUidDariToken(token);
  if (a.currentUser && uidBaru && a.currentUser.uid === uidBaru) {
    // Uid sama: paksa refresh supaya claim `role` dari token server terbaru dipakai.
    await a.currentUser.getIdToken(true);
    return;
  }
  // Uid beda (atau tidak bisa dibaca): buang sesi lama, login bersih.
  if (a.currentUser) await a.signOut();
  await signInWithCustomToken(a, token);
}

/** Uid dari payload JWT custom token (`sub`). null bila format tak terduga. */
function bacaUidDariToken(token: string): string | null {
  try {
    const bagian = token.split(".")[1];
    if (!bagian) return null;
    const base64 = bagian.replace(/-/g, "+").replace(/_/g, "/");
    const padat = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padat)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
