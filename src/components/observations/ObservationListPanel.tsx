"use client";

import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Observation {
  id: string;
  label: string;
  normalizedKey: string;
  value: string;
  unit: string | null;
  confidenceScore: number;
  status: string;
  evidenceBlockIds: string[];
}

interface EvidenceBlock {
  id: string;
  pageNumber: number;
  textContent: string;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  ocrConfidence: number;
}

interface ObservationListPanelProps {
  observations: Observation[];
  currentPageObservations: Observation[];
  activeObservationId: string | null;
  evidenceBlockMap: Map<string, EvidenceBlock>;
  activePage: number;
  onHoverObservation: (
    obsId: string | null,
    bbox: { x1: number; y1: number; x2: number; y2: number } | null
  ) => void;
  onSelectObservation: (
    obsId: string,
    bbox: { x1: number; y1: number; x2: number; y2: number } | null
  ) => void;
}

function getFirstBboxForPage(
  obs: Observation,
  evidenceBlockMap: Map<string, EvidenceBlock>,
  page: number
): { x1: number; y1: number; x2: number; y2: number } | null {
  for (const blockId of obs.evidenceBlockIds) {
    const block = evidenceBlockMap.get(blockId);
    if (block && block.pageNumber === page) {
      return block.bbox;
    }
  }
  return null;
}

const statusColors: Record<string, string> = {
  candidate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  superseded: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  invalidated: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-500",
};

/**
 * Client list component for document-scoped observations.
 * Renders scrollable rows with key fields and exposes hover/select callbacks.
 * // TODO: verify - Document split-view click on an observation row highlights bbox on page image via SVG overlay.
 */
export default function ObservationListPanel({
  observations,
  currentPageObservations,
  activeObservationId,
  evidenceBlockMap,
  activePage,
  onHoverObservation,
  onSelectObservation,
}: ObservationListPanelProps) {
  const handleMouseEnter = useCallback(
    (obs: Observation) => {
      const bbox = getFirstBboxForPage(obs, evidenceBlockMap, activePage);
      onHoverObservation(obs.id, bbox);
    },
    [evidenceBlockMap, activePage, onHoverObservation]
  );

  const handleMouseLeave = useCallback(() => {
    onHoverObservation(null, null);
  }, [onHoverObservation]);

  const handleClick = useCallback(
    (obs: Observation) => {
      const bbox = getFirstBboxForPage(obs, evidenceBlockMap, activePage);
      onSelectObservation(obs.id, bbox);
    },
    [evidenceBlockMap, activePage, onSelectObservation]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, obs: Observation) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick(obs);
      }
    },
    [handleClick]
  );

  // Show current page observations first, then all
  const displayObservations =
    currentPageObservations.length > 0 ? currentPageObservations : observations;

  return (
    <div className="flex flex-col h-full border-l">
      <div className="px-3 py-2 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">
          Observations{" "}
          <span className="text-muted-foreground">
            ({displayObservations.length})
          </span>
        </h3>
        {currentPageObservations.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Page {activePage} — {currentPageObservations.length} observation(s)
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayObservations.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            Aucune observation sur cette page
          </div>
        ) : (
          <ul className="divide-y" role="listbox">
            {displayObservations.map((obs) => (
              <li
                key={obs.id}
                role="option"
                aria-selected={activeObservationId === obs.id}
                tabIndex={0}
                className={cn(
                  "px-3 py-2 cursor-pointer transition-colors hover:bg-accent/50",
                  activeObservationId === obs.id && "bg-accent"
                )}
                onMouseEnter={() => handleMouseEnter(obs)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(obs)}
                onKeyDown={(e) => handleKeyDown(e, obs)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{obs.label}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {obs.normalizedKey}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn("text-xs shrink-0", statusColors[obs.status])}
                  >
                    {obs.status}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {obs.value}
                    {obs.unit ? ` ${obs.unit}` : ""}
                  </span>
                  <span>·</span>
                  <span>
                    Confiance: {((obs.confidenceScore ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
