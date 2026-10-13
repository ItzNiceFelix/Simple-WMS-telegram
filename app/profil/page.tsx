// app/profil/page.tsx — Halaman Profil (Fase F).
// Server component tipis; interaksi di komponen klien ProfilForm.
import { PageHeader } from "@/components/dashboard/page-header";
import { ProfilForm } from "@/components/dashboard/profil-form";

export default function HalamanProfil() {
  return (
    <>
      <PageHeader judul="Profil" deskripsi="Ubah username dan password akun Anda." />
      <ProfilForm />
    </>
  );
}
