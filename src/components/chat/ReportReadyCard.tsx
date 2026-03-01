"use client";

import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface ReportReadyCardProps {
  reportId: string;
  title: string;
  htmlSnapshotUrl: string;
  pdfUrl: string | null;
}

/**
 * Card for completed report generation — Slice 5 §5.13
 * Provides 'Voir le rapport' navigation and PDF download action if pdf_url present.
 */
export function ReportReadyCard({
  reportId,
  title,
  pdfUrl,
}: ReportReadyCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="max-w-[80%] py-0 gap-0 border-green-200 bg-green-50 dark:bg-green-950/20">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm font-medium text-green-800 dark:text-green-200">
            Rapport prêt
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-3 pb-2 space-y-2">
          <p className="text-sm font-medium">{title}</p>
          <div className="flex gap-2">
            <Button size="sm" asChild>
              <Link href={`/reports/${reportId}`}>Voir le rapport</Link>
            </Button>
            {pdfUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  Télécharger PDF
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
