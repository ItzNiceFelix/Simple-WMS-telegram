import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "cn";
import type { StockStatus } from "@/lib/dashboard/types";
import { labelStatus } from "@/lib/dashboard/format";

const statusVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        aman: "border-status-aman/30 bg-status-aman/10 text-status-aman-fg dark:text-status-aman-fg",
        menipis:
          "border-status-menipis/40 bg-status-menipis/15 text-status-menipis-fg dark:text-status-menipis-fg",
        minus: "border-status-minus/30 bg-status-minus/10 text-status-minus-fg dark:text-status-minus-fg",
      },
    },
    defaultVariants: { status: "aman" },
  }
);

export function StatusBadge({
  status,
  className,
}: { status: StockStatus; className?: string } & VariantProps<typeof statusVariants>) {
  return (
    <span className={cn(statusVariants({ status }), className)} data-status={status}>
      {status === "minus" ? (
        <span aria-hidden className="size-1.5 rounded-full bg-status-minus" />
      ) : null}
      {labelStatus(status)}
    </span>
  );
}
