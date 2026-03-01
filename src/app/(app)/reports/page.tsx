"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Report {
  report_id: string;
  title: string;
  status: string;
  version: number;
  created_at: string;
}

/**
 * Reports list UI — Slice 5 §5.13
 * Displays paginated reports from GET /api/reports with filters
 * client_id/status and French empty state CTA to /chat.
 */
export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchReports = useCallback(async (pageNum: number, status: string) => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(pageNum));
      params.set("limit", "20");
      if (status !== "all") {
        params.set("status", status);
      }

      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const fetched: Report[] = data.data ?? [];
      if (pageNum === 1) {
        setReports(fetched);
      } else {
        setReports((prev) => [...prev, ...fetched]);
      }
      setHasMore(fetched.length === 20);
    } catch (err) {
      console.error("[ReportsPage] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchReports(1, statusFilter);
  }, [statusFilter, fetchReports]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchReports(nextPage, statusFilter);
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "final":
        return "default" as const;
      case "draft":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Rapports</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filtrer par statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="draft">En cours</SelectItem>
            <SelectItem value="final">Final</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">
              Aucun rapport trouvé. Lancez une conversation pour générer votre premier rapport ESG.
            </p>
            <Button asChild>
              <Link href="/chat">Démarrer une conversation</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {reports.map((r) => (
            <Card
              key={r.report_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/reports/${r.report_id}`)}
            >
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusBadgeVariant(r.status)}>
                      {r.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      v{r.version}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("fr-FR")}
                </p>
              </CardHeader>
            </Card>
          ))}

          {hasMore && (
            <Button
              variant="ghost"
              onClick={handleLoadMore}
              disabled={isLoading}
            >
              {isLoading ? "Chargement..." : "Charger plus"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
