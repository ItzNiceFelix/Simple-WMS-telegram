# Audit stok dan role

## Koleksi baru

- `admin_role_changes`: audit perubahan role admin.
- `stock_movements`: audit perubahan stok, termasuk snapshot `created_by_username` dan `created_by_name`.

## Field actor pada `stock_movements`

- `created_by`: user yang mengeksekusi perubahan, dipertahankan untuk kompatibilitas.
- `created_by_username`: username Telegram saat pencatatan.
- `created_by_name`: nama hasil onboarding saat pencatatan.
- `requested_by`: user yang membuat instruksi atau draft.
- `requested_by_username`: username Telegram requester saat pencatatan.
- `requested_by_name`: nama hasil onboarding requester saat pencatatan.
- `confirmed_by`: user yang mengonfirmasi draft.
- `confirmed_by_username` / `confirmed_by_name`: snapshot identitas confirmer bila tersedia.
- `confirmed_at`: waktu konfirmasi draft, bila berlaku.

Deploy index sebelum memakai filter histori:

```text
firebase deploy --only firestore:indexes
```

Pastikan Firebase CLI sudah login dan project yang dipilih sesuai dengan `FIREBASE_PROJECT_ID`.
