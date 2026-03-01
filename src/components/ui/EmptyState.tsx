import { Button } from "@/components/ui/button";
import { InboxIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        {icon ?? <InboxIcon className="h-7 w-7 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {ctaLabel && (
        <div className="mt-4">
          {ctaHref ? (
            <Button asChild>
              <a href={ctaHref}>{ctaLabel}</a>
            </Button>
          ) : (
            <Button onClick={onCtaClick}>{ctaLabel}</Button>
          )}
        </div>
      )}
    </div>
  );
}
