"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface ConfirmOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictId: string;
  chosenObservationId: string;
  onSuccess: (winningObservationId: string) => void;
}

export default function ConfirmOverrideDialog({
  open,
  onOpenChange,
  conflictId,
  chosenObservationId,
  onSuccess,
}: ConfirmOverrideDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/conflicts/${conflictId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chosenObservationId,
          reason: reason.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Erreur lors de la résolution");
      }

      onSuccess(chosenObservationId);
      onOpenChange(false);
      setReason("");
      toast.success("Conflit résolu avec succès");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la résolution du conflit");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer le remplacement</AlertDialogTitle>
          <AlertDialogDescription>
            Êtes-vous sûr de vouloir remplacer la valeur gagnante actuelle ?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Textarea
            placeholder="Raison (optionnel, max 500 caractères)"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "En cours..." : "Confirmer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
