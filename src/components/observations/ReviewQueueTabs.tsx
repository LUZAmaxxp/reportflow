"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ObservationReviewRow from "./ObservationReviewRow";
import ObservationEditForm from "./ObservationEditForm";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  categoryId: string | null;
  evidenceBlockIds: string[];
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  parentCategoryId: string | null;
  path: string;
  sortOrder: number;
}

interface TabCounts {
  candidate: number;
  approved: number;
  rejected: number;
}

interface ReviewQueueTabsProps {
  documentId: string;
  initialRows: ObservationRow[];
  currentTab: "candidate" | "approved" | "rejected";
  counts: TabCounts;
  page: number;
  pageSize: number;
  total: number;
  categories: Category[];
}

/**
 * Container component for review queue tab UX.
 * Uses shadcn Tabs with FR labels: Candidat, Approuvé, Rejeté.
 * Syncs active tab/page to URL search params.
 * // TODO: verify - Review queue tabs display correct per-status counts and optimistic row movement on status changes.
 */
export default function ReviewQueueTabs({
  documentId,
  initialRows,
  currentTab,
  counts,
  page,
  pageSize,
  total,
  categories,
}: ReviewQueueTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState(initialRows);
  const [editingObsId, setEditingObsId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleTabChange = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      params.set("page", "1");
      startTransition(() => {
        router.push(`/documents/${documentId}/review?${params.toString()}`);
      });
    },
    [documentId, router, searchParams, startTransition]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(newPage));
      startTransition(() => {
        router.push(`/documents/${documentId}/review?${params.toString()}`);
      });
    },
    [documentId, router, searchParams, startTransition]
  );

  const handleStatusChange = useCallback(
    async (obsId: string, newStatus: string) => {
      // Optimistic removal from current tab
      const previousRows = [...rows];
      setRows((r) => r.filter((row) => row.id !== obsId));

      try {
        const response = await fetch(`/api/observations/${obsId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          // Rollback
          setRows(previousRows);
          if (data.code === "invalid_transition") {
            toast.error(
              `Transition invalide de ${data.from} vers ${data.to}`
            );
          } else {
            toast.error("Erreur lors de la mise à jour du statut");
          }
          return;
        }

        toast.success(
          newStatus === "approved"
            ? "Observation approuvée"
            : newStatus === "rejected"
              ? "Observation rejetée"
              : "Observation reconsidérée"
        );

        // Refresh page data
        startTransition(() => {
          router.refresh();
        });
      } catch {
        setRows(previousRows);
        toast.error("Erreur réseau");
      }
    },
    [rows, router, startTransition]
  );

  const handleEdit = useCallback((obsId: string) => {
    setEditingObsId(obsId);
  }, []);

  const handleSaved = useCallback(
    (updated: any) => {
      setRows((r) =>
        r.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                label: updated.label,
                normalizedKey: updated.normalizedKey,
                value: updated.value,
                unit: updated.unit,
                periodStart: updated.periodStart,
                periodEnd: updated.periodEnd,
                categoryId: updated.categoryId,
              }
            : row
        )
      );
      setEditingObsId(null);
    },
    []
  );

  const editingObs = editingObsId
    ? rows.find((r) => r.id === editingObsId)
    : null;

  return (
    <>
      <Tabs value={currentTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="candidate" className="flex items-center gap-1.5">
            Candidat
            <Badge variant="secondary" className="text-xs">
              {counts.candidate}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="approved" className="flex items-center gap-1.5">
            Approuvé
            <Badge variant="secondary" className="text-xs">
              {counts.approved}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="rejected" className="flex items-center gap-1.5">
            Rejeté
            <Badge variant="secondary" className="text-xs">
              {counts.rejected}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={currentTab} className="mt-4">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Aucune observation dans cet onglet
            </div>
          ) : (
            <div className="border rounded-md">
              {rows.map((row) => (
                <ObservationReviewRow
                  key={row.id}
                  observation={row}
                  activeTab={currentTab}
                  onStatusChange={handleStatusChange}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isPending}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isPending}
                onClick={() => handlePageChange(page + 1)}
              >
                Suivant
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      {editingObs && (
        <ObservationEditForm
          open={!!editingObsId}
          onOpenChange={(open) => {
            if (!open) setEditingObsId(null);
          }}
          observationId={editingObs.id}
          initialValues={{
            label: editingObs.label,
            normalizedKey: editingObs.normalizedKey,
            value: editingObs.value,
            unit: editingObs.unit,
            periodStart: editingObs.periodStart,
            periodEnd: editingObs.periodEnd,
            categoryId: editingObs.categoryId,
          }}
          categories={categories}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
