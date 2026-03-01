"use client";

import { useState, useCallback, useMemo } from "react";
import PageImageViewer from "./PageImageViewer";
import ObservationListPanel from "@/components/observations/ObservationListPanel";

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

interface DocumentSplitViewProps {
  documentId: string;
  pageCount: number;
  observations: Observation[];
  evidenceBlocks?: EvidenceBlock[];
}

/**
 * Client component orchestrates split-view interactions for one document.
 * Two-column layout: PageImageViewer (left) and ObservationListPanel (right).
 */
export default function DocumentSplitView({
  documentId,
  pageCount,
  observations,
  evidenceBlocks = [],
}: DocumentSplitViewProps) {
  const [activePage, setActivePage] = useState(1);
  const [activeObservationId, setActiveObservationId] = useState<string | null>(null);
  const [activeBbox, setActiveBbox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  // Build a map from evidence block id to evidence block details
  const evidenceBlockMap = useMemo(() => {
    const map = new Map<string, EvidenceBlock>();
    for (const eb of evidenceBlocks) {
      map.set(eb.id, eb);
    }
    return map;
  }, [evidenceBlocks]);

  // Filter observations to those that have evidence on the current page
  const currentPageObservations = useMemo(() => {
    return observations.filter((obs) => {
      return obs.evidenceBlockIds.some((blockId) => {
        const block = evidenceBlockMap.get(blockId);
        return block && block.pageNumber === activePage;
      });
    });
  }, [observations, activePage, evidenceBlockMap]);

  const handleSelectObservation = useCallback(
    (obsId: string, bbox: { x1: number; y1: number; x2: number; y2: number } | null) => {
      setActiveObservationId(obsId);
      setActiveBbox(bbox);
    },
    []
  );

  const handleHoverObservation = useCallback(
    (obsId: string | null, bbox: { x1: number; y1: number; x2: number; y2: number } | null) => {
      if (!activeObservationId) {
        setActiveBbox(bbox);
      }
    },
    [activeObservationId]
  );

  const handlePrevPage = useCallback(() => {
    setActivePage((p) => Math.max(1, p - 1));
    setActiveObservationId(null);
    setActiveBbox(null);
  }, []);

  const handleNextPage = useCallback(() => {
    setActivePage((p) => Math.min(pageCount, p + 1));
    setActiveObservationId(null);
    setActiveBbox(null);
  }, [pageCount]);

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      {/* Left: Page image viewer */}
      <div className="flex-1 min-w-0">
        <PageImageViewer
          documentId={documentId}
          pageNumber={activePage}
          activeBbox={activeBbox}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          currentPage={activePage}
          totalPages={pageCount}
        />
      </div>

      {/* Right: Observation panel */}
      <div className="w-96 flex-shrink-0 overflow-auto">
        <ObservationListPanel
          observations={observations}
          currentPageObservations={currentPageObservations}
          activeObservationId={activeObservationId}
          evidenceBlockMap={evidenceBlockMap}
          activePage={activePage}
          onHoverObservation={handleHoverObservation}
          onSelectObservation={handleSelectObservation}
        />
      </div>
    </div>
  );
}
