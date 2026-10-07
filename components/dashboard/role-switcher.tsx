"use client";

// RoleSwitcher — HANYA berguna di mode mock. Di mode real tidak dirender.
import { UserCog } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelRole } from "@/lib/dashboard/format";
import { useSumberData } from "@/lib/dashboard/sumber-data";
import type { Role } from "@/lib/dashboard/types";

const PILIHAN: Role[] = ["owner", "admin", "guest"];

export function RoleSwitcher() {
  const { role, setRole, mode } = useSumberData();
  if (mode !== "mock") return null;

  return (
    <div className="flex items-center gap-2">
      <UserCog aria-hidden className="text-muted-foreground" />
      <Select value={role} onValueChange={(v) => setRole(v as Role)}>
        <SelectTrigger
          size="sm"
          className="h-11 data-[size=sm]:h-11 md:h-7 md:data-[size=sm]:h-7"
          aria-label="Pilih peran (mode mock)"
        >
          <SelectValue>
            {(v: string | null) => (v ? labelRole(v as Role) : "Pilih peran")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PILIHAN.map((r) => (
              <SelectItem key={r} value={r}>
                {labelRole(r)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
