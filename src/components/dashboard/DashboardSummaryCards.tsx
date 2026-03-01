"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fr } from "@/lib/messages/fr";
import type { DashboardSummaryResponse, PipelineStatus } from "@/types/dashboard";
import {
  FileTextIcon,
  ClipboardListIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import Link from "next/link";

interface DashboardSummaryCardsProps {
  data: DashboardSummaryResponse;
}

const statusLabels = fr.pipelineStatus;

export default function DashboardSummaryCards({ data }: DashboardSummaryCardsProps) {
  const totalDocs = Object.values(data.documents_by_status).reduce((a, b) => a + b, 0);
  const reviewReady = data.documents_by_status.review_ready;
  const failed = data.documents_by_status.failed;

  return (
    <div className="space-y-6">
      {/* Summary cards row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{fr.documents.title}</CardTitle>
            <FileTextIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDocs}</div>
            <p className="text-xs text-muted-foreground">
              {reviewReady} {statusLabels.review_ready.toLowerCase()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{fr.dashboard.unresolvedConflicts}</CardTitle>
            <AlertTriangleIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.unresolved_conflict_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{fr.reports.title}</CardTitle>
            <ClipboardListIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.recent_reports.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{statusLabels.failed}</CardTitle>
            <AlertTriangleIcon className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{failed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent documents + reports */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{fr.dashboard.recentDocuments}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent_documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{fr.dashboard.noDocuments}</p>
            ) : (
              <ul className="space-y-3">
                {data.recent_documents.map((doc) => (
                  <li key={doc.document_id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/documents/${doc.document_id}`}
                      className="font-medium hover:underline truncate max-w-[200px]"
                    >
                      {doc.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {(() => {
                        try {
                          return formatDistanceToNow(new Date(doc.created_at), {
                            addSuffix: true,
                            locale: frLocale,
                          });
                        } catch {
                          return "";
                        }
                      })()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{fr.dashboard.recentReports}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent_reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{fr.dashboard.noReports}</p>
            ) : (
              <ul className="space-y-3">
                {data.recent_reports.map((report) => (
                  <li key={report.report_id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/reports/${report.report_id}`}
                      className="font-medium hover:underline"
                    >
                      Rapport v{report.version} — {fr.reports.status[report.status]}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {(() => {
                        try {
                          return formatDistanceToNow(new Date(report.generated_at), {
                            addSuffix: true,
                            locale: frLocale,
                          });
                        } catch {
                          return "";
                        }
                      })()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
