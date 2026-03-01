"use client";

import { useCallback, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const editFormSchema = z.object({
  label: z.string().min(1).max(200),
  normalizedKey: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,99}$/,
      "Doit commencer par une lettre minuscule, uniquement a-z, 0-9, _"
    ),
  value: z.string().min(1).max(500),
  unit: z.string().max(50),
  periodStart: z.string(),
  periodEnd: z.string(),
  categoryId: z.string(),
});

type EditFormValues = z.infer<typeof editFormSchema>;

interface Category {
  id: string;
  name: string;
  description: string | null;
  parentCategoryId: string | null;
  path: string;
  sortOrder: number;
}

interface ObservationEditFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observationId: string;
  initialValues: {
    label: string;
    normalizedKey: string;
    value: string;
    unit: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    categoryId: string | null;
  };
  categories: Category[];
  onSaved: (updated: any) => void;
}

/**
 * Form component used for inline/dialog observation edits.
 * Built with react-hook-form and zodResolver.
 */
export default function ObservationEditForm({
  open,
  onOpenChange,
  observationId,
  initialValues,
  categories,
  onSaved,
}: ObservationEditFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      label: initialValues.label,
      normalizedKey: initialValues.normalizedKey,
      value: initialValues.value,
      unit: initialValues.unit ?? "",
      periodStart: initialValues.periodStart ?? "",
      periodEnd: initialValues.periodEnd ?? "",
      categoryId: initialValues.categoryId ?? "",
    },
  });

  // Reset form when initialValues change
  useEffect(() => {
    form.reset({
      label: initialValues.label,
      normalizedKey: initialValues.normalizedKey,
      value: initialValues.value,
      unit: initialValues.unit ?? "",
      periodStart: initialValues.periodStart ?? "",
      periodEnd: initialValues.periodEnd ?? "",
      categoryId: initialValues.categoryId ?? "",
    });
  }, [initialValues, form]);

  const onSubmit = useCallback(
    async (values: EditFormValues) => {
      setIsSubmitting(true);
      try {
        const body: Record<string, unknown> = {};

        if (values.label !== initialValues.label) body.label = values.label;
        if (values.normalizedKey !== initialValues.normalizedKey)
          body.normalizedKey = values.normalizedKey;
        if (values.value !== initialValues.value) body.value = values.value;
        if ((values.unit ?? "") !== (initialValues.unit ?? ""))
          body.unit = values.unit || null;
        if ((values.periodStart ?? "") !== (initialValues.periodStart ?? ""))
          body.periodStart = values.periodStart || null;
        if ((values.periodEnd ?? "") !== (initialValues.periodEnd ?? ""))
          body.periodEnd = values.periodEnd || null;
        if ((values.categoryId ?? "") !== (initialValues.categoryId ?? ""))
          body.categoryId = values.categoryId || null;

        const response = await fetch(`/api/observations/${observationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data.errors) {
            for (const err of data.errors) {
              form.setError(err.field as any, { message: err.message });
            }
            return;
          }
          toast.error("Erreur lors de la sauvegarde");
          return;
        }

        const updated = await response.json();
        toast.success("Observation modifiée");
        onSaved(updated);
        onOpenChange(false);
      } catch {
        toast.error("Erreur réseau");
      } finally {
        setIsSubmitting(false);
      }
    },
    [observationId, initialValues, form, onSaved, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-serif">Modifier l&apos;observation</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input id="label" {...form.register("label")} />
            {form.formState.errors.label && (
              <p className="text-xs text-destructive">
                {form.formState.errors.label.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="normalizedKey">Clé normalisée</Label>
            <Input
              id="normalizedKey"
              {...form.register("normalizedKey")}
              className="font-mono"
            />
            {form.formState.errors.normalizedKey && (
              <p className="text-xs text-destructive">
                {form.formState.errors.normalizedKey.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="value">Valeur</Label>
              <Input id="value" {...form.register("value")} />
              {form.formState.errors.value && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.value.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unité</Label>
              <Input id="unit" {...form.register("unit")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="periodStart">Début de période</Label>
              <Input
                id="periodStart"
                type="date"
                {...form.register("periodStart")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodEnd">Fin de période</Label>
              <Input
                id="periodEnd"
                type="date"
                {...form.register("periodEnd")}
              />
              {form.formState.errors.periodEnd && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.periodEnd.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="categoryId">Catégorie</Label>
            <Select
              value={form.watch("categoryId") || "__none__"}
              onValueChange={(val) =>
                form.setValue("categoryId", val === "__none__" ? "" : val)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Aucune catégorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Aucune catégorie</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border hover:bg-muted"
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-accent hover:bg-accent/90 text-background">
              {isSubmitting ? "Sauvegarde…" : "Sauvegarder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
