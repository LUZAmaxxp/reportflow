"use client";

import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type PipelineStatus =
  | "uploaded"
  | "ocr_processing"
  | "ocr_done"
  | "embedding"
  | "embedded"
  | "extracting"
  | "review_ready"
  | "failed";

const STATUS_MAP: Record<PipelineStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; isProcessing: boolean }> = {
  uploaded: { label: "En attente", variant: "secondary", isProcessing: false },
  ocr_processing: { label: "OCR en cours…", variant: "default", isProcessing: true },
  ocr_done: { label: "OCR terminé", variant: "secondary", isProcessing: false },
  embedding: { label: "Analyse…", variant: "default", isProcessing: true },
  embedded: { label: "Analysé", variant: "secondary", isProcessing: false },
  extracting: { label: "Extraction…", variant: "default", isProcessing: true },
  review_ready: { label: "Prêt", variant: "outline", isProcessing: false },
  failed: { label: "Échec", variant: "destructive", isProcessing: false },
};

interface DocumentStatusBadgeProps {
  status: PipelineStatus | string;
  className?: string;
}

export default function DocumentStatusBadge({ status, className }: DocumentStatusBadgeProps) {
  const config = STATUS_MAP[status as PipelineStatus] ?? {
    label: status,
    variant: "outline" as const,
    isProcessing: false,
  };

  const badge = (
    <Badge variant={config.variant} className={cn("text-xs", className)}>
      {config.isProcessing && (
        <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {config.label}
    </Badge>
  );

  // Framer Motion pulse only on active processing states
  if (config.isProcessing) {
    return (
      <motion.div
        animate={{ opacity: [1, 0.7, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        className="inline-flex"
      >
        {badge}
      </motion.div>
    );
  }

  return badge;
}
