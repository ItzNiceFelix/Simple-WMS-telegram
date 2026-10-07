"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

import { filterItems } from "@/lib/dashboard/comboboxFilter.js"

type ComboboxItem = { value: string; label: string }

interface ComboboxProps {
  value: string | null
  onChange: (v: string | null) => void
  items: ComboboxItem[]
  placeholder?: string
  kosongTeks?: string
  disabled?: boolean
  id?: string
  "data-testid"?: string
}

function Combobox({
  value,
  onChange,
  items,
  placeholder = "Pilih...",
  kosongTeks = "Tidak ada hasil",
  disabled = false,
  id,
  "data-testid": dataTestId,
}: ComboboxProps) {
  const [query, setQuery] = React.useState("")
  const [terbuka, setTerbuka] = React.useState(false)

  // Satu sumber kebenaran untuk pencarian (dipakai juga oleh test CJS).
  const itemsTerfilter = React.useMemo(
    () => filterItems(items, query),
    [items, query]
  )

  // Base UI memakai nilai objek item sebagai value; komponen ini mengekspos
  // string value ke pemanggil (pola Select). Adaptasi di boundary.
  const nilaiObjek = React.useMemo(
    () => items.find((it) => it.value === value) ?? null,
    [items, value]
  )

  return (
    <ComboboxPrimitive.Root<ComboboxItem>
      items={items}
      value={nilaiObjek}
      onValueChange={(it: ComboboxItem | null) => onChange(it ? it.value : null)}
      onInputValueChange={(q: string) => setQuery(q)}
      onOpenChange={(open: boolean) => setTerbuka(open)}
      itemToStringLabel={(it: ComboboxItem | null) => (it ? it.label : "")}
      itemToStringValue={(it: ComboboxItem | null) => (it ? it.value : "")}
      disabled={disabled}
      filteredItems={itemsTerfilter}
    >
      <ComboboxPrimitive.InputGroup
        data-slot="combobox-input-group"
        className={cn(
          "flex h-11 w-full items-center gap-1.5 rounded-lg border border-input bg-transparent pr-1 pl-2.5 transition-colors md:h-8 dark:bg-input/30",
          "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:bg-input/50 has-[input:disabled]:opacity-50",
          "dark:has-[input:disabled]:bg-input/80"
        )}
      >
        <ComboboxPrimitive.Input
          id={id}
          data-testid={dataTestId}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "h-full w-full min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm",
            "disabled:pointer-events-none"
          )}
        />
        <ComboboxPrimitive.Clear
          aria-label="Kosongkan pilihan"
          className={cn(
            "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
          )}
        >
          <XIcon />
        </ComboboxPrimitive.Clear>
        <ComboboxPrimitive.Trigger
          aria-label="Buka daftar"
          disabled={disabled}
          className={cn(
            "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
          )}
        >
          <ChevronDownIcon
            className={cn("transition-transform", terbuka && "rotate-180")}
          />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          side="bottom"
          sideOffset={4}
          align="start"
          className="isolate z-50"
        >
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            className={cn(
              "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            )}
          >
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {kosongTeks}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="scroll-my-1 p-1">
              {(it: ComboboxItem) => (
                <ComboboxPrimitive.Item
                  key={it.value}
                  value={it}
                  className={cn(
                    "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
                    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                  )}
                >
                  <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
                    {it.label}
                  </span>
                  <ComboboxPrimitive.ItemIndicator
                    render={
                      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                    }
                  >
                    <CheckIcon className="pointer-events-none" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

export { Combobox }
export type { ComboboxProps, ComboboxItem }
