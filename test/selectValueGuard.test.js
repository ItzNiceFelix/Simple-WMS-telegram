// test/selectValueGuard.test.js
// Q10: cegah bug <SelectValue /> polos yang menampilkan NILAI MENTAH (mis. gudang_id uuid)
// alih-alih label. Base UI Select.Value tanpa render-fn memanggil serializeValue(value).
//
// Bug ini NYATA terjadi di 8 lokasi (opname-gudang, histori, pengaturan, aksi-role-admin,
// dialog-tambah-admin, dialog-user-gudang-jabatan, role-switcher).
//
// Guard: source-grep. Setiap <SelectValue /> polos di file aplikasi -> GAGAL.
// Bila ada kasus sah (mis. nilainya memang teks yang benar), tambahkan komentar
// "selectvalue-ok" di baris yang sama.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AKAR = path.join(__dirname, "..");
const DIR = ["app", "components"];

function kumpulkanTsx(dir, out = []) {
  const penuh = path.join(AKAR, dir);
  if (!fs.existsSync(penuh)) return out;
  for (const e of fs.readdirSync(penuh, { withFileTypes: true })) {
    const p = path.join(penuh, e.name);
    if (e.isDirectory()) kumpulkanTsx(path.join(dir, e.name), out);
    else if (e.name.endsWith(".tsx")) out.push(path.join(dir, e.name));
  }
  return out;
}

test("tidak ada <SelectValue /> polos di app/ atau components/", () => {
  const pelanggar = [];
  for (const rel of kumpulkanTsx("app").concat(kumpulkanTsx("components"))) {
    const isi = fs.readFileSync(path.join(AKAR, rel), "utf8");
    const baris = isi.split(/\r?\n/);
    for (let i = 0; i < baris.length; i++) {
      if (!/<SelectValue\s*\/>/.test(baris[i])) continue;
      if (baris[i].includes("selectvalue-ok")) continue;
      pelanggar.push(rel.replace(/\\/g, "/") + ":" + (i + 1));
    }
  }
  assert.deepEqual(
    pelanggar,
    [],
    "SelectValue polos menampilkan nilai mentah (bukan label). Pakai render-fn: " +
      "<SelectValue>{(v) => label}</SelectValue>. Pelanggar: " + pelanggar.join(", ")
  );
});

test("file yang pernah kena bug memakai render-fn SelectValue", () => {
  const wajib = [
    "app/opname-gudang/page.tsx",
    "app/histori/page.tsx",
    "app/pengaturan/page.tsx",
    "components/dashboard/dialog-user-gudang-jabatan.tsx",
  ];
  for (const rel of wajib) {
    const isi = fs.readFileSync(path.join(AKAR, rel), "utf8");
    assert.ok(
      /<SelectValue>\s*\{/.test(isi) || /<SelectValue>\s*\n\s*\{/.test(isi),
      rel + " harus memakai <SelectValue>{...}</SelectValue> dengan render-fn"
    );
  }
});
