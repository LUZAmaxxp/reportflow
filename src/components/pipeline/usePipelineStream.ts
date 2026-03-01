"use client";

import { useEffect, useState, useCallback } from "react";
import { usePipelineSSE } from "@/components/pipeline/PipelineSSEProvider";
import type { PipelineEvent } from "@/lib/pipeline/events";

interface PipelineStreamOptions {
  documentId?: string;
  documentVersionId?: string;
}

interface PipelineStreamState {
  status: string | null;
  error: string | null;
  lastEvent: PipelineEvent | null;
}

/**
 * Provides typed handlers for pipeline_stage_changed, pipeline_failed,
 * extraction_complete; supports filtering by documentId/documentVersionId
 * and emits state updates for status badges.
 */
export function usePipelineStream(
  options: PipelineStreamOptions = {}
): PipelineStreamState & { statusMap: Map<string, string> } {
  const { subscribe } = usePipelineSSE();
  const [state, setState] = useState<PipelineStreamState>({
    status: null,
    error: null,
    lastEvent: null,
  });
  const [statusMap, setStatusMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const unsubscribe = subscribe((event: PipelineEvent) => {
      if (event.type === "heartbeat") return;

      // Filter by documentId/documentVersionId if specified
      if (event.type === "pipeline_stage_changed" || event.type === "pipeline_failed" || event.type === "extraction_complete") {
        const matchesDoc = !options.documentId || event.documentId === options.documentId;
        const matchesVersion =
          !options.documentVersionId || event.documentVersionId === options.documentVersionId;

        if (!matchesDoc && !matchesVersion) return;

        if (event.type === "pipeline_stage_changed") {
          setState({
            status: event.pipelineStatus,
            error: null,
            lastEvent: event,
          });

          setStatusMap((prev) => {
            const next = new Map(prev);
            next.set(event.documentVersionId, event.pipelineStatus);
            next.set(event.documentId, event.pipelineStatus);
            return next;
          });
        }

        if (event.type === "pipeline_failed") {
          setState({
            status: "failed",
            error: event.error,
            lastEvent: event,
          });

          setStatusMap((prev) => {
            const next = new Map(prev);
            next.set(event.documentVersionId, "failed");
            next.set(event.documentId, "failed");
            return next;
          });
        }

        if (event.type === "extraction_complete") {
          setState((prev) => ({
            ...prev,
            lastEvent: event,
          }));
        }
      }
    });

    return unsubscribe;
  }, [subscribe, options.documentId, options.documentVersionId]);

  return { ...state, statusMap };
}
