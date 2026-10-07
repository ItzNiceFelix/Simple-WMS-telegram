// test/helpers/mockFirestore.js
// In-memory mock Firestore untuk unit test. Bukan framework — cuma pasang
// minimal surface yang dipakai lib/ (doc get/set/update/delete, collection.add,
// where().limit().get(), runTransaction).
//
// PENTING: installMockFirestore() harus dipanggil SEBELUM require modul yang
// menarik lib/firebase.js, karena lib/firebase.js memanggil getFirestore() saat load.

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyMerge(target, payload, merge) {
  if (merge) return { ...(target || {}), ...payload };
  return { ...payload };
}

function installMockFirestore() {
  const collections = new Map();

  const storeFor = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const makeDocRef = (name, id, colRef) => {
    const stringId = String(id);
    return {
      id: stringId,
      async get() {
        const data = storeFor(name).get(stringId);
        return {
          id: stringId,
          exists: data !== undefined,
          data: () => clone(data) || {},
        };
      },
      async set(payload, options = {}) {
        const store = storeFor(name);
        store.set(stringId, applyMerge(store.get(stringId), payload, options.merge));
        return true;
      },
      async update(payload) {
        const store = storeFor(name);
        // Tiru Firestore FieldValue.delete(): hapus key dari dokumen, JANGAN simpan sentinel.
        const adaDelete =
          payload &&
          typeof payload === "object" &&
          Object.values(payload).some((v) => v && typeof v === "object" && v.__hapusField === true);
        const adaArrayUnion =
          payload &&
          typeof payload === "object" &&
          Object.values(payload).some((v) => v && typeof v === "object" && v.__arrayUnion);
        if (adaDelete || adaArrayUnion) {
          const hasil = { ...(store.get(stringId) || {}) };
          for (const [k, v] of Object.entries(payload)) {
            if (v && typeof v === "object" && v.__hapusField === true) delete hasil[k];
            else if (v && typeof v === "object" && v.__arrayUnion) {
              const lama = Array.isArray(hasil[k]) ? hasil[k] : [];
              hasil[k] = [...new Set([...lama, ...v.__arrayUnion])];
            } else hasil[k] = v;
          }
          store.set(stringId, hasil);
          return true;
        }
        store.set(stringId, { ...(store.get(stringId) || {}), ...payload });
        return true;
      },
      async delete() {
        storeFor(name).delete(stringId);
        return true;
      },
      collection: colRef,
    };
  };

  // Bandingkan nilai yg mungkin Date/ISO-string (clone JSON mengubah Date jadi string).
  const keNilai = (v) => {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return Date.parse(v);
    return v;
  };
  const BANDING = {
    "==": (a, b) => a === b,
    ">=": (a, b) => keNilai(a) >= keNilai(b),
    "<=": (a, b) => keNilai(a) <= keNilai(b),
    ">": (a, b) => keNilai(a) > keNilai(b),
    "<": (a, b) => keNilai(a) < keNilai(b),
  };

  const makeQuery = (name, filters) => {
    const self = {
      where(field, op, value) {
        if (!BANDING[op]) throw new Error(`mockFirestore: operator ${op} belum didukung`);
        return makeQuery(name, [...filters, { field, op, value }]);
      },
      limit(n) {
        self._limit = n;
        return self;
      },
      async get() {
        let docs = [...storeFor(name).entries()]
          .filter(([, data]) =>
            filters.every((f) => (data ? BANDING[f.op](data[f.field], f.value) : false))
          )
          .map(([id, data]) => ({
            id,
            exists: true,
            data: () => clone(data),
          }));
        if (self._limit !== undefined) docs = docs.slice(0, self._limit);
        return { empty: docs.length === 0, docs };
      },
    };
    return self;
  };

  const makeCollectionRef = (name) => {
    const colRef = {
      doc: (id) => makeDocRef(name, id ?? `${name}-${Math.random().toString(36).slice(2)}`, colRef),
      async add(payload) {
        const id = `${name}-${Math.random().toString(36).slice(2)}`;
        storeFor(name).set(id, { ...payload });
        return makeDocRef(name, id, colRef);
      },
      where: (field, op, value) => makeQuery(name, []).where(field, op, value),
      limit: (n) => makeQuery(name, []).limit(n),
      async get() {
        return makeQuery(name, []).get();
      },
    };
    return colRef;
  };

  // Firestore asli MEN-SERIALISASI transaksi (optimistic concurrency). Mock ini meniru
  // sifat itu lewat antrean mutex supaya test race (dua runTransaction paralel) bermakna:
  // transaksi kedua baru mulai setelah transaksi pertama selesai -> CAS/create-only teruji.
  let _antreanTx = Promise.resolve();

  const db = {
    collection: (name) => makeCollectionRef(name),
    runTransaction(fn) {
      const jalankan = async () =>
        fn({
          get: (ref) => ref.get(),
          set: (ref, payload, options) => ref.set(payload, options),
          update: (ref, payload) => ref.update(payload),
          delete: (ref) => ref.delete(),
        });
      const hasil = _antreanTx.then(jalankan, jalankan);
      // Rantai antrean: teruskan walau transaksi ini gagal (jangan putus antrean).
      _antreanTx = hasil.then(
        () => undefined,
        () => undefined
      );
      return hasil;
    },
  };

  const adminApp = require("firebase-admin/app");
  const adminFirestore = require("firebase-admin/firestore");
  adminApp.getApps = () => [];
  adminApp.initializeApp = () => ({ name: "mock-app" });
  adminFirestore.getFirestore = () => db;
  // FieldValue.delete() cukup jadi sentinel yang dikenali `update()` di atas. `FieldValue`
  // bisa jadi getter non-writable -> fallback ke defineProperty.
  const fieldValueMock = {
    delete: () => ({ __hapusField: true }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    increment: (n) => ({ __increment: n }),
    arrayUnion: (...items) => ({ __arrayUnion: items }),
  };
  Object.defineProperty(adminFirestore, "FieldValue", { value: fieldValueMock, configurable: true });

  // Bersihkan cache lib/firebase.js supaya tiap test dapat instance db mock baru.
  delete require.cache[require.resolve("../../lib/firebase")];

  return { db, collections };
}

module.exports = { installMockFirestore };
