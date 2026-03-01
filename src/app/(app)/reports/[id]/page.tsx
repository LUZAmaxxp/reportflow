"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { ReportIframe } from "@/components/reports/ReportIframe";
import { VersionSidebar } from "@/components/reports/VersionSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ReportDetail {
  report_id: string;
  title: string;
  status: string;
  version: number;
  html_snapshot_url: string | null;
  pdf_url: string | null;
  created_at: string;
}

interface ReportVersion {
  report_id: string;
  version: number;
  title: string;
  status: string;
  source_report_id: string | null;
  generated_at: string;
}

/**
 * Report detail and regeneration controls — Slice 5 §5.13
 * Loads report detail with fresh presigned html_snapshot_url and pdf_url,
 * renders sandboxed iframe, version sidebar, regenerate dialog,
 * and 3s polling while pdf_url is null.
 */
export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.id as string;

  const [report, setReport] = useState<ReportDetail | null>(null);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${reportId}`);
      if (!res.ok) {
        setError("Rapport introuvable.");
        return;
      }
      const data = await res.json();
      setReport(data);
    } catch {
      setError("Erreur de chargement.");
    }
  }, [reportId]);

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${reportId}/versions`);
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data.versions);
    } catch {
      // Non-critical: silently ignore version fetch errors
    }
  }, [reportId]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchReport(), fetchVersions()]).finally(() =>
      setIsLoading(false)
    );
  }, [fetchReport, fetchVersions]);

  // 3s polling while pdf_url is null (report generating)
  useEffect(() => {
    if (report && !report.pdf_url) {
      pollRef.current = setInterval(async () => {
        await fetchReport();
      }, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [report?.status, report?.pdf_url, fetchReport]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Chargement du rapport...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">{error ?? "Rapport introuvable."}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 bg-background">
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground font-serif">{report.title}</h1>
            <Badge
              variant={report.status === "final" ? "default" : "secondary"}
            >
              {report.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              v{report.version}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {report.pdf_url ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={report.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                >
                  Télécharger PDF
                </a>
              </Button>
            ) : report.status === "draft" ? (
              <span className="text-xs text-muted-foreground animate-pulse">
                Génération du PDF en cours...
              </span>
            ) : null}
          </div>
        </div>

        {/* Report iframe — Slice 5 AC: sandboxed iframe, no dangerouslySetInnerHTML */}
        <div className="flex-1 p-4 bg-gradient-to-br from-background via-muted/20 to-background">
          {report.html_snapshot_url ? (
            <ReportIframe
              htmlSnapshotUrl={report.html_snapshot_url}
              title={report.title}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">
                Aperçu HTML non disponible.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Version sidebar */}
      <VersionSidebar reportId={reportId} versions={versions} />
    </div>
  );
}
