"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ConfirmOverrideDialog from "@/components/conflicts/ConfirmOverrideDialog";
import { useState } from "react";

interface ConflictObservation {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  sourceDocumentFilename: string | null;
  uploadedAt: string | null;
}

interface ConflictData {
  id: string;
  normalizedKey: string;
  matchMethod: "exact" | "semantic";
  periodStart: string | null;
  periodEnd: string | null;
  resolutionStatus: "auto_resolved" | "user_reviewed" | "user_overridden";
  autoResolved: boolean;
  winningObservation: ConflictObservation | null;
  losingObservations: ConflictObservation[];
}

interface ConflictCardProps {
  conflict: ConflictData;
  onOverrideSuccess: (conflictId: string, winningObservationId: string) => void;
}

export default function ConflictCard({ conflict, onOverrideSuccess }: ConflictCardProps) {
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [selectedLoserId, setSelectedLoserId] = useState<string | null>(null);

  const period =
    conflict.periodStart && conflict.periodEnd
      ? `${conflict.periodStart} → ${conflict.periodEnd}`
      : conflict.periodStart || conflict.periodEnd || "—";

  const matchMethodLabel = conflict.matchMethod === "exact" ? "Exact" : "Sémantique";

  const handleOverrideClick = (loserId: string) => {
    setSelectedLoserId(loserId);
    setOverrideDialogOpen(true);
  };

  return (
    <>
      <Card className="bg-card border-border hover:border-accent/30 transition-colors">
        <CardContent className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs bg-muted/50 border-border">
              {conflict.normalizedKey}
            </Badge>
            <Badge variant="secondary" className="text-xs bg-muted/70 text-foreground">
              {matchMethodLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">{period}</span>
            {conflict.resolutionStatus === "user_overridden" && (
              <Badge className="text-xs bg-accent/20 text-accent">
                Résolu manuellement
              </Badge>
            )}
          </div>

          {/* Side-by-side columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* Winner column (green) */}
            <div className={cn("rounded-md border p-3", "border-emerald-500/30 bg-emerald-950/20")}>
              <p className="text-xs font-semibold text-emerald-400 mb-1">Gagnant</p>
              {conflict.winningObservation ? (
                <ObsColumn obs={conflict.winningObservation} />
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>

            {/* Loser column (red) */}
            <div className={cn("rounded-md border p-3", "border-red-500/30 bg-red-950/20")}>
              <p className="text-xs font-semibold text-red-400 mb-1">Perdant</p>
              {conflict.losingObservations.map((loser) => (
                <div key={loser.id} className="space-y-1">
                  <ObsColumn obs={loser} />
                  {(conflict.resolutionStatus === "auto_resolved" ||
                    conflict.resolutionStatus === "user_reviewed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 text-xs"
                      onClick={() => handleOverrideClick(loser.id)}
                    >
                      Choisir comme gagnant
                    </Button>
                  )}
                </div>
              ))}
              {conflict.losingObservations.length === 0 && (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedLoserId && (
        <ConfirmOverrideDialog
          open={overrideDialogOpen}
          onOpenChange={setOverrideDialogOpen}
          conflictId={conflict.id}
          chosenObservationId={selectedLoserId}
          onSuccess={(winningId) => onOverrideSuccess(conflict.id, winningId)}
        />
      )}
    </>
  );
}

function ObsColumn({ obs }: { obs: ConflictObservation }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium truncate">{obs.label}</p>
      <p className="text-sm">
        {obs.value}
        {obs.unit ? ` ${obs.unit}` : ""}
      </p>
      {obs.sourceDocumentFilename && (
        <p className="text-xs text-muted-foreground truncate">
          {obs.sourceDocumentFilename}
        </p>
      )}
      {obs.uploadedAt && (
        <p className="text-xs text-muted-foreground">
          {new Date(obs.uploadedAt).toLocaleDateString("fr-FR")}
        </p>
      )}
    </div>
  );
}
