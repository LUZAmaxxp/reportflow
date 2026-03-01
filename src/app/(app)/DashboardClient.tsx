"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSummaryResponse, PipelineStatus } from "@/types/dashboard";
import { usePipelineSSE } from "@/components/pipeline/PipelineSSEProvider";
import DashboardSummaryCards from "@/components/dashboard/DashboardSummaryCards";
import PipelineStatusBar from "@/components/dashboard/PipelineStatusBar";
import OnboardingWelcomeCard from "@/components/dashboard/OnboardingWelcomeCard";

const DASHBOARD_REFRESH_DEBOUNCE_MS = 2000;

interface DashboardClientProps {
  initialData: DashboardSummaryResponse | null;
}

export default function DashboardClient({ initialData }: DashboardClientProps) {
  const router = useRouter();
  const { subscribe } = usePipelineSSE();
  const [data, setData] = useState(initialData);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced router.refresh for RSC consistency
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, DASHBOARD_REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "pipeline_stage_changed") {
        // Immediate local-state update for status counts
        setData((prev) => {
          if (!prev) return prev;
          const newCounts = { ...prev.documents_by_status };
          const newStatus = (event as any).pipelineStatus as PipelineStatus;
          // Increment target status count
          if (newStatus in newCounts) {
            newCounts[newStatus] = (newCounts[newStatus] ?? 0) + 1;
          }
          return { ...prev, documents_by_status: newCounts };
        });
        scheduleRefresh();
      }

      if (
        event.type === "conflict_detected" ||
        (event as any).type === "notification"
      ) {
        scheduleRefresh();
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [subscribe, scheduleRefresh]);

  // Update local data when RSC re-renders with new initialData
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  if (!data) {
    return <OnboardingWelcomeCard />;
  }

  const totalDocs = Object.values(data.documents_by_status).reduce((a, b) => a + b, 0);

  if (totalDocs === 0) {
    return <OnboardingWelcomeCard />;
  }

  return (
    <div className="space-y-6">
      <PipelineStatusBar documentsByStatus={data.documents_by_status} />
      <DashboardSummaryCards data={data} />
    </div>
  );
}
