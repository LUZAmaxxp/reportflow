"use client";

import { fr } from "@/lib/messages/fr";
import type { PipelineStatus } from "@/types/dashboard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PipelineStatusBarProps {
  documentsByStatus: Record<PipelineStatus, number>;
}

const statusColors: Record<PipelineStatus, string> = {
  uploaded: "bg-slate-600",
  ocr_processing: "bg-blue-500",
  ocr_done: "bg-cyan-500",
  embedding: "bg-purple-500",
  embedded: "bg-indigo-500",
  extracting: "bg-orange-500",
  review_ready: "bg-emerald-500",
  failed: "bg-red-500",
};

const statusOrder: PipelineStatus[] = [
  "uploaded",
  "ocr_processing",
  "ocr_done",
  "embedding",
  "embedded",
  "extracting",
  "review_ready",
  "failed",
];

const statusLabels = fr.pipelineStatus;

export default function PipelineStatusBar({ documentsByStatus }: PipelineStatusBarProps) {
  const total = Object.values(documentsByStatus).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground mb-2 font-serif">{fr.dashboard.pipelineStatus}</p>
        <div className="h-4 rounded-full bg-muted/30" />
        <p className="text-xs text-muted-foreground mt-2">
          {fr.dashboard.noDocuments}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium text-foreground mb-2 font-serif">{fr.dashboard.pipelineStatus}</p>
      <TooltipProvider>
        <div className="flex h-4 overflow-hidden rounded-full">
          {statusOrder.map((status) => {
            const count = documentsByStatus[status];
            if (count === 0) return null;
            const pct = (count / total) * 100;
            return (
              <Tooltip key={status}>
                <TooltipTrigger asChild>
                  <div
                    className={`${statusColors[status]} transition-all duration-300`}
                    style={{ width: `${pct}%`, minWidth: count > 0 ? "4px" : "0" }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <span>
                    {statusLabels[status]}: {count}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <div className="mt-3 flex flex-wrap gap-3">
        {statusOrder.map((status) => {
          const count = documentsByStatus[status];
          if (count === 0) return null;
          return (
            <div key={status} className="flex items-center gap-1.5 text-xs">
              <div className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />
              <span className="text-muted-foreground">
                {statusLabels[status]}: <span className="text-foreground font-medium">{count}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
