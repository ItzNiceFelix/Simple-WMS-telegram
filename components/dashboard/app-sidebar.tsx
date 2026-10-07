"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "cn";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { RoleSwitcher } from "@/components/dashboard/role-switcher";
import { itemUntukRole } from "@/components/dashboard/nav-config";
import { useRole } from "@/lib/dashboard/sumber-data";

export function AppSidebar() {
  const role = useRole();
  const pathname = usePathname();
  const items = itemUntukRole(role);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:flex md:flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <ShieldCheck aria-hidden className="size-5 text-primary" />
        <span className="text-sm font-semibold">Admin Toko</span>
      </div>
      <nav aria-label="Navigasi utama" className="flex flex-1 flex-col gap-1 px-2 pb-4">
        {items.map((item) => {
          const aktif = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              variant={aktif ? "secondary" : "ghost"}
              size="lg"
              className="justify-start"
              aria-current={aktif ? "page" : undefined}
              render={<Link href={item.href} data-nav={item.href} />}
            >
              <Icon data-icon="inline-start" />
              {item.label}
            </Button>
          );
        })}
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3">
        <RoleSwitcher />
        <ThemeToggle />
      </div>
    </aside>
  );
}
