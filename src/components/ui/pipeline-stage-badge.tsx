import { cn } from "@/lib/utils";

type PipelineStage =
  | "uploaded"
  | "ocr_processing"
  | "ocr_done"
  | "embedding"
  | "embedded"
  | "extracting"
  | "review_ready"
  | "failed";

const stageLabels: Record<PipelineStage, string> = {
  uploaded: "Uploadé",
  ocr_processing: "OCR en cours",
  ocr_done: "OCR terminé",
  embedding: "Embedding",
  embedded: "Embarqué",
  extracting: "Extraction",
  review_ready: "Prêt pour révision",
  failed: "Échec",
};

const stageColors: Record<PipelineStage, string> = {
  uploaded: "bg-slate-600/20 text-slate-300 border-slate-500/30",
  ocr_processing: "bg-blue-600/20 text-blue-300 border-blue-500/30 animate-pulse-slow",
  ocr_done: "bg-cyan-600/20 text-cyan-300 border-cyan-500/30",
  embedding: "bg-purple-600/20 text-purple-300 border-purple-500/30",
  embedded: "bg-indigo-600/20 text-indigo-300 border-indigo-500/30",
  extracting: "bg-orange-600/20 text-orange-300 border-orange-500/30 animate-pulse-slow",
  review_ready: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-600/20 text-red-300 border-red-500/30",
};

export interface PipelineStageBadgeProps {
  stage: PipelineStage;
  showLabel?: boolean;
  className?: string;
}

export function PipelineStageBadge({
  stage,
  showLabel = true,
  className,
}: PipelineStageBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
        stageColors[stage],
        className
      )}
    >
      <div className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {showLabel && stageLabels[stage]}
    </div>
  );
}
