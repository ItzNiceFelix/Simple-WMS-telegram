import type { ReactNode } from "react";

export function PageHeader({
  judul,
  deskripsi,
  aksi,
}: {
  judul: string;
  deskripsi?: string;
  aksi?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{judul}</h1>
        {deskripsi ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{deskripsi}</p>
        ) : null}
      </div>
      {aksi ? <div className="flex items-center gap-2">{aksi}</div> : null}
    </div>
  );
}
