"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConflictCard from "@/components/conflicts/ConflictCard";

interface ConflictObservation {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  sourceDocumentFilename: string | null;
  uploadedAt: string | null;
}

interface ConflictData {
  id: string;
  normalizedKey: string;
  conflictGroupId: string;
  matchMethod: "exact" | "semantic";
  periodStart: string | null;
  periodEnd: string | null;
  resolutionStatus: "auto_resolved" | "user_reviewed" | "user_overridden";
  autoResolved: boolean;
  winningObservation: ConflictObservation | null;
  losingObservations: ConflictObservation[];
  createdAt: string;
}

interface ConflictListResponse {
  data: ConflictData[];
  total: number;
  page: number;
  pageSize: number;
}

interface ConflictInboxPageProps {
  initialData?: ConflictListResponse;
}

export default function ConflictInboxPage({ initialData }: ConflictInboxPageProps) {
  const [conflicts, setConflicts] = useState<ConflictData[]>(initialData?.data ?? []);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [pageSize, setPageSize] = useState(initialData?.pageSize ?? 20);
  const [resolutionStatus, setResolutionStatus] = useState<string>("__all__");
  const [matchMethod, setMatchMethod] = useState<string>("__all__");
  const [isPending, startTransition] = useTransition();

  const fetchConflicts = useCallback(async () => {
    const params = new URLSearchParams();
    if (resolutionStatus !== "__all__") params.set("resolutionStatus", resolutionStatus);
    if (matchMethod !== "__all__") params.set("matchMethod", matchMethod);
    params.set("page", String(page));
    params.set("limit", String(pageSize));

    try {
      const res = await fetch(`/api/conflicts?${params.toString()}`);
      if (!res.ok) return;
      const data: ConflictListResponse = await res.json();
      setConflicts(data.data);
      setTotal(data.total);
    } catch (err) {
      console.error("[ConflictInboxPage] fetch error", err);
    }
  }, [resolutionStatus, matchMethod, page, pageSize]);

  useEffect(() => {
    startTransition(() => {
      fetchConflicts();
    });
  }, [fetchConflicts]);

  // Listen for SSE conflict_detected events
  useEffect(() => {
    const eventSource = new EventSource("/api/pipeline/events");
    eventSource.addEventListener("conflict_detected", () => {
      fetchConflicts();
    });
    return () => eventSource.close();
  }, [fetchConflicts]);

  const handleOverrideSuccess = useCallback(
    (conflictId: string, winningObservationId: string) => {
      // Optimistic update
      setConflicts((prev) =>
        prev.map((c) => {
          if (c.id !== conflictId) return c;
          const allObs = [c.winningObservation, ...c.losingObservations].filter(Boolean) as ConflictObservation[];
          const newWinner = allObs.find((o) => o.id === winningObservationId) ?? c.winningObservation;
          const newLosers = allObs.filter((o) => o.id !== winningObservationId);
          return {
            ...c,
            resolutionStatus: "user_overridden" as const,
            winningObservation: newWinner,
            losingObservations: newLosers,
          };
        })
      );
    },
    []
  );

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conflits</h1>
        <p className="text-sm text-muted-foreground">
          {total} conflit{total !== 1 ? "s" : ""} trouvé{total !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex gap-4">
        <div className="w-48">
          <Select
            value={resolutionStatus}
            onValueChange={(val) => {
              setResolutionStatus(val);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Tous" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tous</SelectItem>
              <SelectItem value="auto_resolved">Non résolus</SelectItem>
              <SelectItem value="user_overridden">Résolus</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select
            value={matchMethod}
            onValueChange={(val) => {
              setMatchMethod(val);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Méthode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Toutes les méthodes</SelectItem>
              <SelectItem value="exact">Exact</SelectItem>
              <SelectItem value="semantic">Sémantique</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conflict list */}
      {conflicts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
          <p className="text-muted-foreground">Aucun conflit non résolu</p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              onOverrideSuccess={handleOverrideSuccess}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {page > 1 && (
            <button
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
            >
              Précédent
            </button>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
            >
              Suivant
            </button>
          )}
        </div>
      )}
    </div>
  );
}
