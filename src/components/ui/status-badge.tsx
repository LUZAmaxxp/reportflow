import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        approved: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
        candidate: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
        rejected: "bg-red-500/15 text-red-300 border border-red-500/30",
        conflict: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
        superseded: "bg-slate-500/15 text-slate-300 border border-slate-500/30",
        processing:
          "bg-blue-500/15 text-blue-300 border border-blue-500/30 animate-pulse-slow",
      },
    },
    defaultVariants: {
      variant: "candidate",
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBadgeVariants> {}

export function StatusBadge({
  className,
  variant,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <div className={cn(statusBadgeVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}
