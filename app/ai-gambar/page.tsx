// app/ai-gambar/page.tsx — Studio gambar produk (Fase D).
// Server component tipis: pagar viewport ditegakkan di klien (§10.1) karena
// ukuran layar tak bisa dipastikan di server. Tautan menu ada di nav-config
// ("Studio Gambar"); layar kecil menampilkan arahan buka di PC.
import { PagarViewport } from "@/components/dashboard/pagar-viewport";

export const dynamic = "force-dynamic";

export default function HalamanAiGambar() {
  return <PagarViewport />;
}
