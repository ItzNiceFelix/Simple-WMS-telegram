"use client";

// app/masuk/page.tsx — Login web telegramId+password (PRD F1, Fase 1).
// Tanpa Telegram Mini App. Sukses → cookie swt_sesi (HttpOnly) → redirect /.
// Lupa password → minta kode via bot → reset dengan kode.
import { useState } from "react";
import { useRouter } from "next/navigation";

type Tahap = "masuk" | "minta-kode" | "reset";

export default function HalamanMasuk() {
  const router = useRouter();
  const [tahap, setTahap] = useState<Tahap>("masuk");
  const [tgId, setTgId] = useState("");
  const [password, setPassword] = useState("");
  const [kode, setKode] = useState("");
  const [passwordBaru, setPasswordBaru] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function kirim(path: string, body: unknown) {
    setSibuk(true);
    setPesan(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setPesan(data?.error ?? `Gagal (${res.status}).`);
        return false;
      }
      return true;
    } catch {
      setPesan("Jaringan gagal. Coba lagi.");
      return false;
    } finally {
      setSibuk(false);
    }
  }

  async function aksiMasuk(e: React.FormEvent) {
    e.preventDefault();
    if (await kirim("/api/auth/login", { tg_id: tgId.trim(), password })) router.push("/");
  }

  async function aksiMintaKode(e: React.FormEvent) {
    e.preventDefault();
    if (await kirim("/api/auth/minta-kode", { tg_id: tgId.trim() })) {
      setTahap("reset");
      setPesan("Kode dikirim via bot Telegram. Berlaku 10 menit.");
    }
  }

  async function aksiReset(e: React.FormEvent) {
    e.preventDefault();
    if (await kirim("/api/auth/reset-password", { tg_id: tgId.trim(), kode: kode.trim(), password_baru: passwordBaru })) {
      setTahap("masuk");
      setPassword("");
      setPesan("Password baru tersimpan. Masuk dengan password baru.");
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Masuk Simple-WMS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tahap === "masuk" && "Masuk dengan telegramId + password."}
          {tahap === "minta-kode" && "Masukkan telegramId untuk menerima kode via bot."}
          {tahap === "reset" && "Masukkan kode dari bot + password baru."}
        </p>

        {tahap === "masuk" && (
          <form onSubmit={aksiMasuk} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">telegramId</span>
              <input
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
                inputMode="numeric"
                autoComplete="username"
                value={tgId}
                onChange={(e) => setTgId(e.target.value)}
                placeholder="cth. 123456789"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={sibuk}
              className="w-full rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sibuk ? "Memproses…" : "Masuk"}
            </button>
            <button type="button" onClick={() => setTahap("minta-kode")} className="w-full text-center text-sm text-primary">
              Lupa password?
            </button>
          </form>
        )}

        {tahap === "minta-kode" && (
          <form onSubmit={aksiMintaKode} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">telegramId</span>
              <input
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
                inputMode="numeric"
                value={tgId}
                onChange={(e) => setTgId(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={sibuk}
              className="w-full rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sibuk ? "Mengirim…" : "Kirim kode via bot"}
            </button>
            <button type="button" onClick={() => setTahap("masuk")} className="w-full text-center text-sm text-primary">
              Kembali masuk
            </button>
          </form>
        )}

        {tahap === "reset" && (
          <form onSubmit={aksiReset} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Kode 6 digit</span>
              <input
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-xl tracking-[0.3em]"
                inputMode="numeric"
                maxLength={6}
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password baru (min. 6)</span>
              <input
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base"
                type="password"
                autoComplete="new-password"
                value={passwordBaru}
                onChange={(e) => setPasswordBaru(e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button
              type="submit"
              disabled={sibuk}
              className="w-full rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sibuk ? "Menyimpan…" : "Simpan password baru"}
            </button>
            <button type="button" onClick={() => setTahap("masuk")} className="w-full text-center text-sm text-primary">
              Kembali masuk
            </button>
          </form>
        )}

        {pesan && (
          <p role="alert" className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
            {pesan}
          </p>
        )}
      </div>
    </div>
  );
}
