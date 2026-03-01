"use client";

/**
 * Safe report HTML preview component — Slice 5 §5.13
 * Renders iframe with sandbox='allow-scripts allow-same-origin'
 * and never uses dangerouslySetInnerHTML.
 */
interface ReportIframeProps {
  htmlSnapshotUrl: string;
  title?: string;
}

export function ReportIframe({ htmlSnapshotUrl, title }: ReportIframeProps) {
  return (
    <iframe
      src={htmlSnapshotUrl}
      title={title ?? "Aperçu du rapport"}
      sandbox="allow-scripts allow-same-origin"
      className="w-full h-full border-0 rounded-md"
      style={{ minHeight: "600px" }}
    />
  );
}
