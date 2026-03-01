"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ObservationRow {
  id: string;
  label: string;
  normalizedKey: string;
  value: string;
  unit: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidenceScore: number;
  status: string;
  evidenceBlockIds: string[];
}

interface ObservationReviewRowProps {
  observation: ObservationRow;
  activeTab: "candidate" | "approved" | "rejected";
  onStatusChange: (obsId: string, newStatus: string) => Promise<void>;
  onEdit: (obsId: string) => void;
}

const confidenceColor = (score: number) => {
  if (score >= 0.9) return "text-green-600 dark:text-green-400";
  if (score >= 0.7) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
};

/**
 * Reusable row component for review queue tabs.
 * Displays observation fields and actions based on tab context.
 * Supports optimistic tab migration with rollback + toast on failure.
 */
export default function ObservationReviewRow({
  observation,
  activeTab,
  onStatusChange,
  onEdit,
}: ObservationReviewRowProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setIsProcessing(true);
      try {
        await onStatusChange(observation.id, newStatus);
      } catch {
        toast.error("Échec de la mise à jour du statut");
      } finally {
        setIsProcessing(false);
      }
    },
    [observation.id, onStatusChange]
  );

  const periodDisplay =
    observation.periodStart && observation.periodEnd
      ? `${observation.periodStart} → ${observation.periodEnd}`
      : observation.periodStart || observation.periodEnd || "—";

  return (
    <div className="flex items-center justify-between gap-3 p-3 border-b last:border-b-0 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{observation.label}</span>
          <Badge variant="outline" className="text-xs font-mono shrink-0">
            {observation.normalizedKey}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {observation.value}
            {observation.unit ? ` ${observation.unit}` : ""}
          </span>
          <span>{periodDisplay}</span>
          <span className={cn("font-medium", confidenceColor(observation.confidenceScore))}>
            {((observation.confidenceScore ?? 0) * 100).toFixed(0)}%
          </span>
          {observation.evidenceBlockIds.length > 0 && (
            <span>
              {observation.evidenceBlockIds.length} source(s)
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {activeTab === "candidate" && (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={isProcessing}
              onClick={() => handleStatusChange("approved")}
            >
              Approuver
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isProcessing}
              onClick={() => handleStatusChange("rejected")}
            >
              Rejeter
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isProcessing}
              onClick={() => onEdit(observation.id)}
            >
              Modifier
            </Button>
          </>
        )}

        {activeTab === "rejected" && (
          <Button
            size="sm"
            variant="outline"
            disabled={isProcessing}
            onClick={() => handleStatusChange("candidate")}
          >
            Reconsidérer
          </Button>
        )}

        {activeTab === "approved" && (
          <Button
            size="sm"
            variant="outline"
            disabled={isProcessing}
            onClick={() => onEdit(observation.id)}
          >
            Modifier
          </Button>
        )}
      </div>
    </div>
  );
}
