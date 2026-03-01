"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ManualObsPrefilled } from "@/types/chat";

interface ManualObsPopupProps {
  pendingId: string;
  prefilled: ManualObsPrefilled;
  onClose: () => void;
}

/**
 * Modal form for pending manual observation completion — Slice 5 §5.13
 * Implements popup fields/validations, 10-minute countdown,
 * confirm and skip actions, timeout toast auto-close behavior.
 */
export function ManualObsPopup({ pendingId, prefilled, onClose }: ManualObsPopupProps) {
  const [label, setLabel] = useState(prefilled.label ?? "");
  const [value, setValue] = useState(prefilled.value ?? "");
  const [unit, setUnit] = useState(prefilled.unit ?? "");
  const [dataType, setDataType] = useState<"numeric" | "percentage" | "text" | "boolean">(prefilled.data_type ?? "numeric");
  const [timeBehavior, setTimeBehavior] = useState<"periodic" | "point_in_time" | "none">(prefilled.time_behavior ?? "none");
  const [periodStart, setPeriodStart] = useState(prefilled.period_start ?? "");
  const [periodEnd, setPeriodEnd] = useState(prefilled.period_end ?? "");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(600); // 10 minutes
  const [isTimedOut, setIsTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 10-minute countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsTimedOut(true);
          if (timerRef.current) clearInterval(timerRef.current);
          // Auto-close after timeout toast
          setTimeout(() => onClose(), 3000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [onClose]);

  // Poll pending status to detect external timeout
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/manual-observations/pending/${pendingId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== "pending") {
          setIsTimedOut(true);
          setTimeout(() => onClose(), 2000);
        }
      } catch {
        // Ignore poll errors
      }
    };

    const interval = setInterval(pollStatus, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [pendingId, onClose]);

  const formatTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  const handleConfirm = async () => {
    setError(null);

    // Client-side validation
    if (!label.trim()) {
      setError("Le libellé est requis.");
      return;
    }
    if (!value.trim()) {
      setError("La valeur est requise.");
      return;
    }
    if (periodStart && periodEnd && periodStart > periodEnd) {
      setError("La date de début doit précéder la date de fin.");
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        label: label.trim(),
        normalized_key: prefilled.normalized_key,
        value: value.trim(),
        unit: unit.trim() || null,
        data_type: dataType,
        time_behavior: timeBehavior,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        note: note.trim() || null,
      };

      const res = await fetch(`/api/manual-observations/pending/${pendingId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        setError("Cette observation a déjà été traitée.");
        setTimeout(() => onClose(), 2000);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de la confirmation.");
        return;
      }

      onClose();
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setIsSkipping(true);
    try {
      const res = await fetch(`/api/manual-observations/pending/${pendingId}/skip`, {
        method: "POST",
      });

      if (res.status === 409) {
        setError("Cette observation a déjà été traitée.");
        setTimeout(() => onClose(), 2000);
        return;
      }

      onClose();
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setIsSkipping(false);
    }
  };

  const isDisabled = isSubmitting || isSkipping || isTimedOut;

  return (
    <Dialog open onOpenChange={() => !isDisabled && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Donnée manuelle requise</DialogTitle>
          <DialogDescription>
            Complétez ou confirmez les informations ci-dessous.
          </DialogDescription>
        </DialogHeader>

        {/* Countdown timer */}
        <div
          className={`text-center text-sm font-mono ${
            secondsLeft <= 60
              ? "text-destructive font-bold"
              : "text-muted-foreground"
          }`}
        >
          {isTimedOut ? (
            <span className="text-destructive">Délai expiré — fermeture automatique</span>
          ) : (
            <span>Temps restant : {formatTime(secondsLeft)}</span>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="obs-label">Libellé *</Label>
            <Input
              id="obs-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={isDisabled}
              placeholder="Ex: Émissions CO2 scope 1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="obs-value">Valeur *</Label>
              <Input
                id="obs-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={isDisabled}
                placeholder="Ex: 1234.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obs-unit">Unité</Label>
              <Input
                id="obs-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                disabled={isDisabled}
                placeholder="Ex: tCO2e"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Type de données</Label>
            <Select value={dataType} onValueChange={(v) => setDataType(v as typeof dataType)} disabled={isDisabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="numeric">Numérique</SelectItem>
                <SelectItem value="percentage">Pourcentage</SelectItem>
                <SelectItem value="text">Texte</SelectItem>
                <SelectItem value="boolean">Booléen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Comportement temporel</Label>
            <Select value={timeBehavior} onValueChange={(v) => setTimeBehavior(v as typeof timeBehavior)} disabled={isDisabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="periodic">Périodique</SelectItem>
                <SelectItem value="point_in_time">Point dans le temps</SelectItem>
                <SelectItem value="none">Aucun</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="obs-period-start">Début de période</Label>
              <Input
                id="obs-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                disabled={isDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obs-period-end">Fin de période</Label>
              <Input
                id="obs-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                disabled={isDisabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="obs-note">Note d&apos;attestation</Label>
            <Input
              id="obs-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isDisabled}
              placeholder="Optionnel — justification de la valeur"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isDisabled}
          >
            {isSkipping ? "En cours..." : "Passer"}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isDisabled}
          >
            {isSubmitting ? "Confirmation..." : "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
