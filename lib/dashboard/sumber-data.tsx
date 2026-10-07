"use client";

// lib/dashboard/sumber-data.tsx
// Provider React untuk role + DataSource.
// Mode MOCK: role dapat disuntik lewat query param ?role=owner|admin|guest (HANYA mock, R11).
// Mode REAL: role datang dari sesi server. Tidak ada cabang bypass di jalur real.
//
// Alur boot mode real (penting): DataSource TIDAK dibangun sampai sesi tervalidasi.
// Shell menahan render konten selama fase "memuat", sehingga halaman tidak pernah
// memanggil data source yang belum siap (mencegah error palsu saat pembukaan pertama).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { assertMockAllowedInThisEnv, dataMode, isMockMode, type DataSource } from "./data";
import { makeMockDataSource } from "./data/mock";
import type { Role } from "./types";

// Catatan bundling: implementasi REAL (Firebase SDK) dimuat dinamis agar build mode mock
// TIDAK memuat Firebase sama sekali (isolasi e2e + bundle kecil).

export type StatusAuth = "siap" | "memuat" | "perlu_masuk" | "gagal";

/** Batas waktu inisialisasi sesi sebelum menyerah (ms). */
const BATAS_INISIALISASI_MS = 10_000;

interface SumberDataValue {
  mode: "mock" | "real";
  role: Role;
  setRole: (r: Role) => void;
  data: DataSource;
  /** R11: true bila mode mock aktif di lingkungan yang tidak diizinkan. */
  mockTidakDiizinkan: boolean;
  /** Status sesi (mode real). Mode mock selalu "siap". */
  statusAuth: StatusAuth;
  pesanAuth: string | null;
  /** Coba ulang inisialisasi sesi (tombol "Coba lagi"). */
  coba: () => void;
}

const Ctx = createContext<SumberDataValue | null>(null);

const ROLE_VALID: Role[] = ["owner", "admin", "guest"];

function roleDariQuery(): Role | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("role");
  if (raw && (ROLE_VALID as string[]).includes(raw)) return raw as Role;
  return null;
}

export function SumberDataProvider({ children }: { children: ReactNode }) {
  const mode = dataMode();
  const [role, setRole] = useState<Role>("owner");
  const [guardError, setGuardError] = useState(false);
  const [statusAuth, setStatusAuth] = useState<StatusAuth>(
    mode === "mock" ? "siap" : "memuat"
  );
  const [pesanAuth, setPesanAuth] = useState<string | null>(null);
  // DataSource real HANYA diisi setelah sesi tervalidasi.
  const [dataReal, setDataReal] = useState<DataSource | null>(null);
  const [percobaan, setPercobaan] = useState(0);
  // Role terkini untuk closure data source (mode real).
  const roleRef = useRef(role);
  roleRef.current = role;

  const coba = useCallback(() => {
    setPesanAuth(null);
    setDataReal(null);
    setStatusAuth("memuat");
    setPercobaan((n) => n + 1);
  }, []);

  useEffect(() => {
    try {
      assertMockAllowedInThisEnv();
    } catch {
      setGuardError(true);
      return;
    }

    // Mode mock: siap sinkron, tanpa jaringan.
    if (isMockMode()) {
      const dariQuery = roleDariQuery();
      if (dariQuery) setRole(dariQuery);
      setStatusAuth("siap");
      return;
    }

    // Mode real: import -> validasi sesi -> baru siap. Dengan batas waktu.
    let batal = false;
    const jeda = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Waktu masuk habis. Periksa koneksi lalu coba lagi.")),
        BATAS_INISIALISASI_MS
      );
    });

    void (async () => {
      try {
        await Promise.race([
          (async () => {
            const mod = await import("./data/real");
            const ds = mod.makeRealDataSource(() => roleRef.current);
            const s = await ds.getSession();
            if (batal) return;
            setRole(s.role);
            setDataReal(ds);
            setStatusAuth("siap");
          })(),
          jeda,
        ]);
      } catch (e) {
        if (batal) return;
        const pesan = e instanceof Error ? e.message : String(e);
        // Tanpa cookie sesi valid → halaman login web (PRD F1), bukan Telegram.
        setPesanAuth(pesan);
        setStatusAuth("perlu_masuk");
      }
    })();

    return () => {
      batal = true;
    };
  }, [mode, percobaan]);

  const value = useMemo<SumberDataValue>(() => {
    const getRole = () => role;
    const data: DataSource =
      mode === "mock" ? makeMockDataSource(getRole) : dataReal!;
    return {
      mode,
      role,
      setRole,
      data,
      mockTidakDiizinkan: guardError,
      statusAuth,
      pesanAuth,
      coba,
    };
  }, [mode, role, guardError, statusAuth, pesanAuth, dataReal, coba]);

  if (guardError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-center text-foreground">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Konfigurasi tidak valid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Mode data mock tidak diizinkan di lingkungan ini. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              NEXT_PUBLIC_DASHBOARD_DATA=real
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  // Mode real sebelum sesi siap: JANGAN sediakan data source.
  // Shell menahan render konten (statusAuth "memuat"/"perlu_masuk"/"gagal"),
  // jadi nilai ini tidak pernah dipakai untuk query.
  if (mode === "real" && !dataReal) {
    return (
      <Ctx.Provider
        value={{
          mode,
          role,
          setRole,
          data: dataKosong(),
          mockTidakDiizinkan: guardError,
          statusAuth,
          pesanAuth,
          coba,
        }}
      >
        {children}
      </Ctx.Provider>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** DataSource kosong untuk fase sebelum sesi siap (tidak pernah dipanggil konten). */
function dataKosong(): DataSource {
  const tolak = () => {
    throw new Error("Sesi belum siap.");
  };
  return {
    getSession: tolak,
    getRingkasan: tolak,
    listStock: tolak,
    getProduk: tolak,
    listMovements: tolak,
    listOpnameDrafts: tolak,
    listSyncDrafts: tolak,
    listDailyRequests: tolak,
    listAdmins: tolak,
    listRoleChanges: tolak,
    listAccessRequests: tolak,
    getAiSettings: tolak,
    mutasiStok: tolak,
    ubahProviderAi: tolak,
    ubahHpp: tolak,
    ubahReorderPoint: tolak,
    ubahRoleAdmin: tolak,
    tambahAdmin: tolak,
    hapusAdmin: tolak,
    // v3a (B4): `satisfies DataSource` menagih 6 method ini; tsc gagal bila ketinggalan.
    sesuaikanQtyPermintaan: tolak,
    kirimFormPermintaan: tolak,
    tandaiPermintaanDatang: tolak,
    selesaikanPermintaan: tolak,
    listKeywordNotes: tolak,
    konfirmasiKeywordNote: tolak,
    // v3b Fase A (A-W3/A-W4): satisfies DataSource menagih 3 method ini.
    setujuiAkses: tolak,
    tolakAkses: tolak,
    tambahProduk: tolak,
    // v3b Fase B (A2 konfirmasi-draft): `satisfies DataSource` menagih 2 method ini.
    listPickingDrafts: tolak,
    konfirmasiDraft: tolak,
    // v5 (F1 gudang + F2 set-qty + F7 opname + F8 toggle online).
    listGudang: tolak,
    tambahGudang: tolak,
    ubahGudang: tolak,
    setQtyGudang: tolak,
    mutasiStokGudang: tolak,
    toggleOnlineProduk: tolak,
    listOpnameGudang: tolak,
    buatOpnameGudang: tolak,
    setujuiOpnameGudang: tolak,
    tolakOpnameGudang: tolak,
    // v5 (F5/F6 permintaan antar-gudang).
    listPermintaanGudang: tolak,
    buatPermintaanGudang: tolak,
    ubahItemPermintaan: tolak,
    setujuiTujuanGudang: tolak,
    tolakTujuanPermintaanGudang: tolak,
    tolakPermintaanGudang: tolak,
    batalPermintaanGudang: tolak,
    kirimPermintaanGudang: tolak,
    terimaPermintaanGudang: tolak,
    tidakTerimaPermintaanGudang: tolak,
    selesaiPermintaanGudang: tolak,
    tutupTujuanPermintaanGudang: tolak,
    setGudangUser: tolak,
    setJabatan: tolak,
    listUserTujuan: tolak,
  } satisfies DataSource;
}

export function useSumberData(): SumberDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSumberData harus dipakai di dalam SumberDataProvider");
  return v;
}

export function useData(): DataSource {
  return useSumberData().data;
}

export function useRole(): Role {
  return useSumberData().role;
}
