# Pengaturan provider AI

Command `/settings` hanya dapat dipakai oleh admin dengan role `owner` atau
Super Admin yang terdaftar lewat `SUPER_ADMIN_ID`.

Command tersebut menampilkan inline keyboard untuk memilih provider teks:

- `Gemini`
- `Groq`

Pilihan disimpan di dokumen Firestore `system_settings/ai`, field `textProvider`.
Cache runtime berlaku sekitar 30 detik; setelah itu instance function akan membaca
perubahan terbaru dari Firestore tanpa redeploy.

API key tetap wajib disimpan sebagai environment variable:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`

Jika dokumen belum ada, provider awal mengikuti `AI_PROVIDER_TEXT` bila valid,
atau `groq` sebagai default.