"use client"

// components/dashboard/editor-operasi.ts — PENERAP operasi kanvas dari AI (Fase 7+).
//
// KENAPA TERPISAH dari editor-desain.tsx:
//   Berkas ini murni "skrip operasi → objek fabric". Ia tidak tahu React, tidak tahu
//   riwayat undo, dan tidak memutuskan KAPAN dijalankan. Yang memutuskan adalah editor
//   (satu tempat: setelah snapshot undo). Memisahkannya membuat aturan penerapan bisa
//   dibaca utuh tanpa ikut menelusuri 1100 baris komponen.
//
// PEMBATAS YANG TIDAK BOLEH DILANGGAR:
//   1. Objek LATAR TERKUNCI (`namaLapisan === "Latar"`, selectable=false) TIDAK PERNAH
//      disentuh: tidak dipindah, tidak dihapus, tidak diubah gayanya. AI yang membuang
//      latar berarti user kehilangan pekerjaan yang tidak digantikan apa pun.
//   2. Op yang tidak bisa dijalankan (id tidak ada, elemen tidak ditemukan) DILEWATI dan
//      dihitung, bukan melempar. Satu op salah dari model tidak boleh membatalkan 20 op
//      lain — dan tidak boleh membuat kanvas setengah jadi tanpa penjelasan.
//   3. Penerap TIDAK menyimpan riwayat dan TIDAK memanggil `catatRiwayat`. Snapshot
//      undo diambil SEKALI oleh pemanggil SEBELUM skrip dijalankan (lihat
//      `terapkanOperasiAi` di editor-desain.tsx) supaya satu permintaan AI = satu langkah
//      undo, bukan puluhan.

import type * as FabricEsModule from "fabric/es"
import type { Canvas as FabricCanvas, FabricObject } from "fabric"

import type { OperasiKanvas } from "@/lib/desain/skemaOperasi"

/** Elemen pustaka yang siap dipakai (hasil `GET /api/desain/elemen?id=`). */
export type ElemenPustaka = { w: number; h: number }

export type HasilTerap = { dijalankan: number; dilewati: number; alasanDilewati: string[] }

/** Nama lapisan latar terkunci — dipakai juga oleh editor (satu ejaan, bukan dua). */
const LAPISAN_LATAR = "Latar"

export function objekTerkunci(o: FabricObject): boolean {
  return String(o.get("namaLapisan") ?? "") === LAPISAN_LATAR
}

/** Cari objek berdasarkan `id` dokumen. `undefined` = tidak ada (op dilewati). */
export function cariObjek(kanvas: FabricCanvas, id: string | undefined): FabricObject | undefined {
  if (!id) return undefined
  return kanvas.getObjects().find((o) => String(o.get("id") ?? "") === id)
}

/**
 * Terapkan SATU op. `true` = ada perubahan yang benar-benar terjadi.
 * `alasanDilewati` diisi supaya UI bisa melaporkan "3 operasi dilewati" dengan sebabnya.
 */
function terapSatu(
  kanvas: FabricCanvas,
  fabric: typeof FabricEsModule,
  op: OperasiKanvas,
  buatId: () => string,
  daftarDilewati: string[]
): boolean {
  const lewati = (alasan: string): false => {
    daftarDilewati.push(`${op.op}: ${alasan}`)
    return false
  }

  switch (op.op) {
    case "tambah_teks": {
      const t = new fabric.IText(op.teks ?? "Teks baru", {
        left: op.x ?? 0,
        top: op.y ?? 0,
        originX: "left",
        originY: "top",
        fontSize: op.ukuran ?? 48,
        fontFamily: op.font ?? "Arial",
        fill: op.warna ?? "#111111",
        fontWeight: op.tebal ? "bold" : "normal",
        fontStyle: op.miring ? "italic" : "normal",
        underline: op.garisBawah === true,
        angle: op.rotasi ?? 0,
        opacity: op.opasitas ?? 1,
      })
      // Lebar dari AI = kehendak tata letak; tinggi dibiarkan hasil render teks supaya
      // huruf tidak gepeng (alasan yang sama dengan terapkanLayout).
      if (op.w && op.w > 0 && (t.width ?? 0) > 0) t.set({ scaleX: op.w / (t.width || 1) })
      kanvas.add(t)
      t.set({ id: buatId(), namaLapisan: "AI Teks" })
      return true
    }

    case "tambah_bentuk": {
      const isi = op.warna ?? "#3b82f6"
      const w = op.w ?? 300
      const h = op.h ?? 300
      const dasar = { left: op.x ?? 0, top: op.y ?? 0, angle: op.rotasi ?? 0, opacity: op.opasitas ?? 1 }
      // SATU bentuk (persegi) untuk op ini: skema tool WAJIB FLAT, jadi bentuk tidak bisa
      // dibawa sebagai field enum terpisah tanpa menambah properti yang hanya berlaku untuk
      // satu op. `h <= 8` dianggap garis tipis supaya "tambah garis" tetap masuk akal.
      // Lingkaran/ikon datang dari pustaka elemen (`sisipkan_elemen`), bukan dari sini.
      const o = new fabric.Rect({
        ...dasar, originX: "left", originY: "top",
        width: w, height: h <= 8 ? Math.max(2, h) : h, fill: isi,
      })
      kanvas.add(o)
      o.set({ id: buatId(), namaLapisan: "AI Bentuk" })
      return true
    }

    case "pindah": {
      const o = cariObjek(kanvas, op.id)
      if (!o) return lewati("id tidak ditemukan")
      if (objekTerkunci(o)) return lewati("objek latar terkunci")
      if (op.x !== undefined) o.set({ left: op.x })
      if (op.y !== undefined) o.set({ top: op.y })
      if (op.rotasi !== undefined) o.set({ angle: op.rotasi })
      o.setCoords()
      return true
    }

    case "ubah_ukuran": {
      const o = cariObjek(kanvas, op.id)
      if (!o) return lewati("id tidak ditemukan")
      if (objekTerkunci(o)) return lewati("objek latar terkunci")
      // Skala relatif terhadap ukuran dasar objek (width/height), bukan skala sekarang:
      // AI berbicara dalam piksel dokumen, jadi hasilnya idempoten.
      if (op.w !== undefined && (o.width ?? 0) > 0) o.set({ scaleX: Math.max(0.01, op.w / (o.width || 1)) })
      if (op.h !== undefined && (o.height ?? 0) > 0) o.set({ scaleY: Math.max(0.01, op.h / (o.height || 1)) })
      o.setCoords()
      return true
    }

    case "hapus": {
      const ids = op.ids && op.ids.length > 0 ? op.ids : op.id ? [op.id] : []
      if (ids.length === 0) return lewati("tanpa id")
      const korban = ids
        .map((id) => cariObjek(kanvas, id))
        .filter((o): o is FabricObject => o !== undefined && !objekTerkunci(o))
      if (korban.length === 0) return lewati("tidak ada objek yang cocok (atau semuanya terkunci)")
      kanvas.remove(...korban)
      return true
    }

    case "ubah_gaya": {
      const ids = op.ids && op.ids.length > 0 ? op.ids : op.id ? [op.id] : []
      if (ids.length === 0) return lewati("tanpa id")
      let ada = false
      for (const id of ids) {
        const o = cariObjek(kanvas, id)
        if (!o || objekTerkunci(o)) continue
        if (op.warna !== undefined) o.set({ fill: op.warna })
        if (op.opasitas !== undefined) o.set({ opacity: op.opasitas })
        // Properti teks hanya bermakna pada objek teks; menyetelnya pada Rect diabaikan fabric.
        if (op.ukuran !== undefined) o.set({ fontSize: op.ukuran })
        if (op.font !== undefined) o.set({ fontFamily: op.font })
        if (op.tebal !== undefined) o.set({ fontWeight: op.tebal ? "bold" : "normal" })
        if (op.miring !== undefined) o.set({ fontStyle: op.miring ? "italic" : "normal" })
        if (op.garisBawah !== undefined) o.set({ underline: op.garisBawah })
        ada = true
      }
      return ada || lewati("tidak ada objek yang cocok (atau semuanya terkunci)")
    }

    case "lapisan": {
      const o = cariObjek(kanvas, op.id)
      if (!o) return lewati("id tidak ditemukan")
      // Menurunkan latar terkunci ke belakang TIDAK apa-apa (ia memang di sana); yang
      // dilarang adalah memindahkannya KE ATAS tumpukan.
      switch (op.arah) {
        case "atas":
          kanvas.bringObjectForward(o)
          return true
        case "bawah":
          kanvas.sendObjectBackwards(o)
          return true
        case "depan":
          kanvas.bringObjectToFront(o)
          return true
        case "belakang":
          if (objekTerkunci(o)) return lewati("latar terkunci sudah di belakang")
          kanvas.sendObjectToBack(o)
          return true
        default:
          return lewati("arah tidak dikenal")
      }
    }

    case "sejajar": {
      const ids = op.ids && op.ids.length > 0 ? op.ids : op.id ? [op.id] : []
      const sasaran = ids
        .map((id) => cariObjek(kanvas, id))
        .filter((o): o is FabricObject => o !== undefined && !objekTerkunci(o))
      if (sasaran.length === 0) return lewati("tidak ada objek yang cocok")
      const lebar = kanvas.getWidth() / (kanvas.getZoom() || 1)
      const tinggi = kanvas.getHeight() / (kanvas.getZoom() || 1)
      for (const o of sasaran) {
        const b = o.getBoundingRect()
        switch (op.sisi) {
          case "kiri":
            o.set({ left: 0 })
            break
          case "tengah":
            o.set({ left: (lebar - b.width) / 2 })
            break
          case "kanan":
            o.set({ left: lebar - b.width })
            break
          case "atas":
            o.set({ top: 0 })
            break
          case "tengah_v":
            o.set({ top: (tinggi - b.height) / 2 })
            break
          case "bawah":
            o.set({ top: tinggi - b.height })
            break
          default:
            return lewati("sisi tidak dikenal")
        }
        o.setCoords()
      }
      return true
    }

    case "distribusi": {
      const ids = op.ids ?? []
      const sasaran = ids
        .map((id) => cariObjek(kanvas, id))
        .filter((o): o is FabricObject => o !== undefined && !objekTerkunci(o))
      if (sasaran.length < 3) return lewati("butuh minimal 3 objek")
      const horizontal = op.sumbu !== "vertikal"
      // Urutkan dulu: jarak yang sama antar objek yang berurutan itulah yang dimaksud
      // "distribusi", bukan sekadar membagi rata urutan array yang dikirim AI.
      const urut = [...sasaran].sort((a, b) => {
        const ba = a.getBoundingRect()
        const bb = b.getBoundingRect()
        return horizontal ? ba.left - bb.left : ba.top - bb.top
      })
      const pertama = urut[0]!.getBoundingRect()
      const terakhir = urut[urut.length - 1]!.getBoundingRect()
      const mulai = horizontal ? pertama.left : pertama.top
      const akhir = horizontal ? terakhir.left + terakhir.width : terakhir.top + terakhir.height
      const total = urut.reduce((n, o) => {
        const b = o.getBoundingRect()
        return n + (horizontal ? b.width : b.height)
      }, 0)
      const jarak = (akhir - mulai - total) / (urut.length - 1)
      let posisi = mulai
      for (const o of urut) {
        const b = o.getBoundingRect()
        if (horizontal) o.set({ left: posisi })
        else o.set({ top: posisi })
        posisi += (horizontal ? b.width : b.height) + jarak
        o.setCoords()
      }
      return true
    }

    case "kelompok": {
      const ids = op.ids ?? []
      const anggota = ids
        .map((id) => cariObjek(kanvas, id))
        .filter((o): o is FabricObject => o !== undefined && !objekTerkunci(o))
      if (anggota.length < 2) return lewati("butuh minimal 2 objek")
      // ActiveSelection dipakai, bukan Group: ia mempertahankan objek aslinya di kanvas
      // (id, nama lapisan, dan riwayat undo tetap utuh). Group akan membuat id baru dan
      // menghapus objek lama — itu kehilangan identitas yang justru dipakai op berikutnya.
      for (const o of anggota) kanvas.remove(o)
      const sel = new fabric.ActiveSelection(anggota, { canvas: kanvas })
      kanvas.add(sel)
      sel.set({ id: buatId(), namaLapisan: "AI Kelompok" })
      kanvas.setActiveObject(sel)
      return true
    }

    case "pisah_kelompok": {
      const sasaran = kanvas.getObjects().filter((o) => o instanceof fabric.ActiveSelection)
      if (sasaran.length === 0) return lewati("tidak ada kelompok")
      for (const s of sasaran) {
        // ActiveSelection punya `getObjects()` (sama seperti Group), tapi tipe dasar
        // FabricObject tidak menyebutnya — sempitkan lewat instanceof di atas, bukan cast
        // pada angggota yang belum diperiksa.
        const isi = s instanceof fabric.ActiveSelection ? s.getObjects() : []
        for (const o of isi) {
          o.set({ left: (s.left ?? 0) + (o.left ?? 0), top: (s.top ?? 0) + (o.top ?? 0) })
          kanvas.add(o)
        }
        kanvas.remove(s)
      }
      kanvas.discardActiveObject()
      return true
    }

    case "latar": {
      if (op.latarBelakang === undefined) return lewati("warna latar kosong")
      kanvas.backgroundColor = op.latarBelakang
      return true
    }

    case "bangun_ulang":
      // Ditangani pemanggil (butuh `validasiLayout` + primitif `tambahObjek`); penerap
      // ini hanya menandai bahwa op-nya dikenal dan TIDAK mengejutkan dengan perubahan.
      return lewati("ditangani editor")

    default:
      return lewati("op tidak dikenal")
  }
}

/**
 * Jalankan seluruh skrip berurutan. Urutan array = urutan eksekusi (penting: menambah
 * lalu memindahkan objek baru adalah pola yang sah).
 */
export function terapkanOperasi(
  kanvas: FabricCanvas,
  fabric: typeof FabricEsModule,
  operasi: readonly OperasiKanvas[],
  buatId: () => string
): HasilTerap {
  const dilewati: string[] = []
  let dijalankan = 0
  for (const op of operasi) {
    if (op.op === "bangun_ulang") continue
    try {
      if (terapSatu(kanvas, fabric, op, buatId, dilewati)) dijalankan += 1
    } catch (e) {
      // Penerap objek fabric bisa melempar untuk masukan yang aneh; satu op gagal tidak
      // boleh membatalkan skrip yang sudah berjalan separuh.
      dilewati.push(`${op.op}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { dijalankan, dilewati: dilewati.length, alasanDilewati: dilewati }
}

/** Elemen pustaka → kotak di dokumen, dipusatkan bila koordinatnya tidak disebut. */
export function kotakElemen(e: ElemenPustaka, lebarDokumen: number, tinggiDokumen: number, op: OperasiKanvas) {
  const w = op.w ?? e.w
  const h = op.h ?? e.h
  return {
    left: op.x ?? (lebarDokumen - w) / 2,
    top: op.y ?? (tinggiDokumen - h) / 2,
    width: w,
    height: h,
  }
}
