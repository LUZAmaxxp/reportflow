"use client";

import { useCallback } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import EmptyState from "@/components/ui/EmptyState";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DocumentRow {
  documentId: string;
  title: string;
  detectedType: string;
  categoryId: string | null;
  clientId: string | null;
  createdAt: string;
  createdBy: string | null;
  latestVersion: {
    documentVersionId: string;
    pipelineStatus: string;
    pageCount: number;
    fileSizeBytes: number;
    createdAt: string;
  } | null;
}

interface DocumentsTableProps {
  documents: DocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading?: boolean;
  optimisticStatuses?: Map<string, string>;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentsTable({
  documents,
  total,
  page,
  pageSize,
  isLoading,
  optimisticStatuses,
}: DocumentsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-7 w-7 text-muted-foreground" />}
        title="Aucun document"
        description="Importez votre premier document pour commencer."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom du fichier</TableHead>
            <TableHead>Catégorie</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Pages</TableHead>
            <TableHead>Taille</TableHead>
            <TableHead>Date de création</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence>
            {documents.map((doc, index) => {
              const status =
                optimisticStatuses?.get(doc.latestVersion?.documentVersionId ?? "") ??
                optimisticStatuses?.get(doc.documentId) ??
                doc.latestVersion?.pipelineStatus ??
                "uploaded";

              return (
                <motion.tr
                  key={doc.documentId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, delay: index * 0.04 }}
                  className="hover:bg-muted/50 transition-colors duration-100 cursor-pointer border-b"
                >
                  <TableCell>
                    <Link
                      href={`/documents/${doc.documentId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {doc.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {doc.categoryId ?? "—"}
                  </TableCell>
                  <TableCell>
                    <DocumentStatusBadge status={status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {doc.latestVersion?.pageCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {doc.latestVersion
                      ? formatFileSize(doc.latestVersion.fileSizeBytes)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {doc.createdAt ? formatDate(doc.createdAt) : "—"}
                  </TableCell>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <span className="text-sm text-muted-foreground">
            {total} document{total !== 1 ? "s" : ""} au total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              asChild={page > 1}
            >
              {page > 1 ? (
                <Link href={`/documents?page=${page - 1}`}>
                  <ChevronLeft className="size-4" />
                </Link>
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages}
              asChild={page < totalPages}
            >
              {page < totalPages ? (
                <Link href={`/documents?page=${page + 1}`}>
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
