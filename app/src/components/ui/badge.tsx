import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        violet: "bg-brand-wash text-brand", // legacy alias
        brand: "bg-brand-wash text-brand",
        orange: "bg-brand-wash text-cta", // legacy alias
        cta: "bg-brand-wash text-cta",
        muted: "bg-surface text-ink-muted border border-line",
        success: "bg-emerald-100 text-emerald-700",
        warn: "bg-amber-100 text-amber-700",
        danger: "bg-rose-100 text-rose-700",
      },
    },
    defaultVariants: { variant: "muted" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
