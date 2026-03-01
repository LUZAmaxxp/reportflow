"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const manualObservationSchema = z.object({
  label: z.string().min(1, "Label requis").max(200),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/, "Format invalide: lettres minuscules, chiffres et _ uniquement"),
  value: z.string().min(1, "Valeur requise"),
  numericValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  dataType: z.enum(["numeric", "percentage", "text", "boolean"]),
  timeBehavior: z.enum(["periodic", "point_in_time", "none"]),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["candidate", "approved"]),
  note: z.string().max(1000).optional(),
  sourceReference: z.string().max(500).optional(),
});

type ManualObservationFormData = z.infer<typeof manualObservationSchema>;

interface ManualObservationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (obs: { id: string; status: string; attestationRecordId: string }) => void;
}

export default function ManualObservationForm({
  open,
  onOpenChange,
  onSuccess,
}: ManualObservationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ManualObservationFormData>({
    resolver: zodResolver(manualObservationSchema),
    defaultValues: {
      status: "candidate",
      dataType: "numeric",
      timeBehavior: "periodic",
    },
  });

  const dataType = watch("dataType");
  const timeBehavior = watch("timeBehavior");

  const onSubmit = async (data: ManualObservationFormData) => {
    // Client-side validation for conditional requirements
    if ((data.dataType === "numeric" || data.dataType === "percentage") && data.numericValue === undefined) {
      toast.error("La valeur numérique est requise pour le type numérique/pourcentage");
      return;
    }
    if (data.timeBehavior === "periodic") {
      if (!data.periodStart || !data.periodEnd) {
        toast.error("Les dates de début et fin sont requises pour le comportement périodique");
        return;
      }
      if (data.periodEnd < data.periodStart) {
        toast.error("La date de fin doit être >= à la date de début");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/observations/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (errorData.field) {
          toast.error(`Erreur: ${errorData.field} - ${errorData.message}`);
        } else {
          toast.error(errorData.message || "Erreur lors de la création");
        }
        return;
      }

      const result = await res.json();
      onSuccess?.(result);
      onOpenChange(false);
      reset();
      toast.success("Observation ajoutée");
    } catch (err) {
      toast.error("Erreur lors de la création de l'observation");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter une observation manuelle</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label">Label *</Label>
            <Input id="label" {...register("label", { required: true, maxLength: 200 })} placeholder="Ex: Émissions CO2 Scope 1" />
            {errors.label && <p className="text-xs text-red-500">{errors.label.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="normalizedKey">Clé normalisée *</Label>
            <Input id="normalizedKey" {...register("normalizedKey")} placeholder="ex: ghg_scope1" className="font-mono text-sm" />
            {errors.normalizedKey && <p className="text-xs text-red-500">{errors.normalizedKey.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="value">Valeur *</Label>
              <Input id="value" {...register("value", { required: true })} />
              {errors.value && <p className="text-xs text-red-500">{errors.value.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unité</Label>
              <Input id="unit" {...register("unit")} placeholder="tCO2e" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type de données *</Label>
              <Select
                value={dataType}
                onValueChange={(val) => setValue("dataType", val as ManualObservationFormData["dataType"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="numeric">Numérique</SelectItem>
                  <SelectItem value="percentage">Pourcentage</SelectItem>
                  <SelectItem value="text">Texte</SelectItem>
                  <SelectItem value="boolean">Booléen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(dataType === "numeric" || dataType === "percentage") && (
              <div className="space-y-1.5">
                <Label htmlFor="numericValue">Valeur numérique *</Label>
                <Input id="numericValue" type="number" step="any" {...register("numericValue", { valueAsNumber: true })} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Comportement temporel *</Label>
            <Select
              value={timeBehavior}
              onValueChange={(val) => setValue("timeBehavior", val as ManualObservationFormData["timeBehavior"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="periodic">Périodique</SelectItem>
                <SelectItem value="point_in_time">Point dans le temps</SelectItem>
                <SelectItem value="none">Aucun</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {timeBehavior === "periodic" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Début *</Label>
                <Input id="periodStart" type="date" {...register("periodStart")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Fin *</Label>
                <Input id="periodEnd" type="date" {...register("periodEnd")} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Statut *</Label>
            <Select
              value={watch("status")}
              onValueChange={(val) => setValue("status", val as "candidate" | "approved")}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="candidate">Candidat</SelectItem>
                <SelectItem value="approved">Approuvé</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" {...register("note")} placeholder="Note optionnelle (max 1000 caractères)" maxLength={1000} rows={2} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sourceReference">Référence source</Label>
            <Input id="sourceReference" {...register("sourceReference")} placeholder="Référence optionnelle (max 500 caractères)" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "En cours..." : "Ajouter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
