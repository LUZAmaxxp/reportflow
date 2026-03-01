"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ManualObsPopup } from "@/components/chat/ManualObsPopup";
import type { ManualObsPrefilled } from "@/types/chat";

interface ManualObsCardProps {
  pendingId: string;
  prefilled: ManualObsPrefilled;
}

/**
 * Inline card for manual observation requests — Slice 5 §5.13
 * Displays pending requirement and CTA opening ManualObsPopup for pending_id.
 */
export function ManualObsCard({ pendingId, prefilled }: ManualObsCardProps) {
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  return (
    <>
      <Card className="max-w-[80%] py-0 gap-0 border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Donnée manuelle requise
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-3 pb-2 space-y-2">
          <p className="text-sm">
            <span className="font-medium">{prefilled.label}</span>
            {prefilled.value && (
              <span className="text-muted-foreground ml-1">
                (suggestion : {prefilled.value}
                {prefilled.unit ? ` ${prefilled.unit}` : ""})
              </span>
            )}
          </p>
          {prefilled.period_start && prefilled.period_end && (
            <p className="text-xs text-muted-foreground">
              Période : {prefilled.period_start} → {prefilled.period_end}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsPopupOpen(true)}
            className="border-yellow-300 hover:bg-yellow-100"
          >
            Compléter
          </Button>
        </CardContent>
      </Card>

      {isPopupOpen && (
        <ManualObsPopup
          pendingId={pendingId}
          prefilled={prefilled}
          onClose={() => setIsPopupOpen(false)}
        />
      )}
    </>
  );
}
