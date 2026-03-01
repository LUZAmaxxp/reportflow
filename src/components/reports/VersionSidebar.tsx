"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ReportVersion {
  report_id: string;
  version: number;
  title: string;
  status: string;
  source_report_id: string | null;
  generated_at: string;
}

interface VersionSidebarProps {
  reportId: string;
  versions: ReportVersion[];
}

/**
 * Version lineage and regeneration entry point — Slice 5 §5.13
 * Lists report versions ordered ascending and provides regenerate dialog
 * trigger with style_instruction input.
 */
export function VersionSidebar({ reportId, versions }: VersionSidebarProps) {
  const router = useRouter();
  const [styleInstruction, setStyleInstruction] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    setError(null);
    setIsRegenerating(true);
    try {
      const body: Record<string, string | undefined> = {};
      if (styleInstruction.trim()) {
        body.style_instruction = styleInstruction.trim();
      }

      const res = await fetch(`/api/reports/${reportId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de la régénération.");
        return;
      }

      const data = await res.json();
      setDialogOpen(false);
      setStyleInstruction("");
      // Navigate to new report
      router.push(`/reports/${data.report_id}`);
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="w-64 border-l bg-background flex flex-col h-full">
      <div className="p-3">
        <h3 className="text-sm font-semibold">Versions</h3>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {versions.map((v) => (
          <button
            key={v.report_id}
            onClick={() => router.push(`/reports/${v.report_id}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              v.report_id === reportId
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">v{v.version}</span>
              <Badge
                variant={v.status === "ready" ? "default" : "secondary"}
                className="text-xs"
              >
                {v.status}
              </Badge>
            </div>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {new Date(v.generated_at).toLocaleDateString("fr-FR")}
            </span>
          </button>
        ))}
      </div>
      <Separator />
      <div className="p-3">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="w-full">
              Régénérer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Régénérer le rapport</DialogTitle>
              <DialogDescription>
                Créer une nouvelle version du rapport. Vous pouvez optionnellement
                préciser des instructions de style.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="style-instruction">
                  Instructions de style (optionnel)
                </Label>
                <Input
                  id="style-instruction"
                  value={styleInstruction}
                  onChange={(e) => setStyleInstruction(e.target.value)}
                  disabled={isRegenerating}
                  placeholder="Ex: Plus concis, tableau récapitulatif en annexe"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isRegenerating}
              >
                Annuler
              </Button>
              <Button onClick={handleRegenerate} disabled={isRegenerating}>
                {isRegenerating ? "Régénération..." : "Régénérer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
