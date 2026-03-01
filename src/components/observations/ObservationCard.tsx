"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ObservationCardProps {
  observation: {
    id: string;
    label: string;
    normalizedKey: string;
    value: string;
    unit: string | null;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    confidenceScore: number;
    sourceDocumentVersionId?: string;
  };
}

const statusLabels: Record<string, string> = {
  candidate: "Candidat",
  approved: "Approuvé",
  rejected: "Rejeté",
  superseded: "Remplacé",
  invalidated: "Invalidé",
};

const statusColors: Record<string, string> = {
  candidate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  superseded: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  invalidated: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500",
};

/**
 * Card component for company-wide observation browsing.
 * Displays core fields with compact layout for paginated grid rendering.
 */
export default function ObservationCard({ observation }: ObservationCardProps) {
  const period =
    observation.periodStart && observation.periodEnd
      ? `${observation.periodStart} → ${observation.periodEnd}`
      : observation.periodStart || observation.periodEnd || "—";

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{observation.label}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {observation.normalizedKey}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={cn("text-xs shrink-0", statusColors[observation.status])}
          >
            {statusLabels[observation.status] ?? observation.status}
          </Badge>
        </div>

        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">
              {observation.value}
              {observation.unit ? ` ${observation.unit}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{period}</span>
            <span>·</span>
            <span>
              Confiance: {((observation.confidenceScore ?? 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
