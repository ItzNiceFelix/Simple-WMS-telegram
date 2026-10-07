"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { itemUntukRole, type NavItem } from "@/components/dashboard/nav-config";
import { useRole } from "@/lib/dashboard/sumber-data";

const MAKS_UTAMA = 4; // sisakan slot kelima utk "Lainnya"

function NavLink({
  item,
  aktif,
  onNavigate,
  className,
}: {
  item: NavItem;
  aktif: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-nav={item.href}
      aria-current={aktif ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.7rem] font-medium text-muted-foreground transition-colors min-h-11",
        aktif && "bg-secondary text-secondary-foreground",
        className
      )}
    >
      <Icon aria-hidden className="size-5" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function BottomNav() {
  const role = useRole();
  const pathname = usePathname();
  const [buka, setBuka] = useState(false);
  const items = itemUntukRole(role);

  const utama = items.filter((i) => i.utama).slice(0, MAKS_UTAMA);
  const sisa = items.filter((i) => !utama.includes(i));

  function aktifUntuk(href: string) {
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  }

  return (
    <nav
      aria-label="Navigasi bawah"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-border bg-background/95 px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
    >
      {utama.map((item) => (
        <NavLink key={item.href} item={item} aktif={aktifUntuk(item.href)} />
      ))}
      {sisa.length > 0 ? (
        <Sheet open={buka} onOpenChange={setBuka}>
          <SheetTrigger
            render={
              <button
                type="button"
                className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.7rem] font-medium text-muted-foreground min-h-11"
                aria-label="Menu lainnya"
              />
            }
          >
            <Menu aria-hidden className="size-5" />
            <span>Lainnya</span>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Menu lainnya</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-4 pb-4">
              {sisa.map((item) => {
                const Icon = item.icon;
                const aktif = aktifUntuk(item.href);
                return (
                  <Button
                    key={item.href}
                    variant={aktif ? "secondary" : "ghost"}
                    size="lg"
                    className="justify-start"
                    aria-current={aktif ? "page" : undefined}
                    render={<Link href={item.href} data-nav={item.href} />}
                    onClick={() => setBuka(false)}
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </nav>
  );
}
