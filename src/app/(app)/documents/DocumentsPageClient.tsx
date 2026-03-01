"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DocumentsTable from "@/components/documents/DocumentsTable";
import UploadButton from "@/components/documents/UploadButton";
import { usePipelineStream } from "@/components/pipeline/usePipelineStream";

interface DocumentsPageClientProps {
  initialDocuments: any[];
  total: number;
  page: number;
  pageSize: number;
  userRole: "admin" | "editor" | "viewer";
}

export default function DocumentsPageClient({
  initialDocuments,
  total,
  page,
  pageSize,
  userRole,
}: DocumentsPageClientProps) {
  const router = useRouter();
  const { statusMap } = usePipelineStream();

  const handleUploadComplete = useCallback(() => {
    router.refresh();
  }, [router]);

  const canUpload = userRole !== "viewer";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground font-serif">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gérez vos documents et suivez leur traitement
          </p>
        </div>
        {canUpload && <UploadButton onUploadComplete={handleUploadComplete} />}
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <DocumentsTable
            documents={initialDocuments}
            total={total}
            page={page}
            pageSize={pageSize}
            optimisticStatuses={statusMap}
          />
        </CardContent>
      </Card>
    </div>
  );
}
