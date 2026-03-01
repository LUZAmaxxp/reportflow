"use client";

import { useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

interface Category {
  id: string;
  name: string;
  description: string | null;
  parentCategoryId: string | null;
  path: string;
  sortOrder: number;
}

interface ObservationFilterPanelProps {
  categories: Category[];
}

const STATUS_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "candidate", label: "Candidat" },
  { value: "approved", label: "Approuvé" },
  { value: "rejected", label: "Rejeté" },
  { value: "superseded", label: "Remplacé" },
];

/**
 * Filter sidebar component for /observations list page.
 * Writes filter state to URL query params for shareable links.
 */
export default function ObservationFilterPanel({
  categories,
}: ObservationFilterPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentStatus = searchParams.get("status") ?? "";
  const currentCategoryId = searchParams.get("categoryId") ?? "";
  const currentNormalizedKey = searchParams.get("normalizedKey") ?? "";
  const currentQ = searchParams.get("q") ?? "";
  const currentPeriodStart = searchParams.get("periodStart") ?? "";
  const currentPeriodEnd = searchParams.get("periodEnd") ?? "";

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("page", "1"); // Reset page on filter change
      startTransition(() => {
        router.push(`/observations?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  const handleReset = useCallback(() => {
    startTransition(() => {
      router.push("/observations");
    });
  }, [router, startTransition]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filtres</h3>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Réinitialiser
        </Button>
      </div>

      {/* Free-text search */}
      <div className="space-y-1.5">
        <Label htmlFor="q" className="text-xs">
          Recherche
        </Label>
        <Input
          id="q"
          placeholder="Label ou clé…"
          defaultValue={currentQ}
          onBlur={(e) => updateFilter("q", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              updateFilter("q", (e.target as HTMLInputElement).value);
            }
          }}
        />
      </div>

      {/* Status filter */}
      <div className="space-y-1.5">
        <Label className="text-xs">Statut</Label>
        <Select
          value={currentStatus || "__all__"}
          onValueChange={(val) =>
            updateFilter("status", val === "__all__" ? "" : val)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Tous" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value || "__all__"}
                value={opt.value || "__all__"}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category filter */}
      <div className="space-y-1.5">
        <Label className="text-xs">Catégorie</Label>
        <Select
          value={currentCategoryId || "__all__"}
          onValueChange={(val) =>
            updateFilter("categoryId", val === "__all__" ? "" : val)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Toutes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Toutes</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Normalized key exact */}
      <div className="space-y-1.5">
        <Label htmlFor="normalizedKey" className="text-xs">
          Clé normalisée
        </Label>
        <Input
          id="normalizedKey"
          placeholder="ex: ghg_scope1"
          className="font-mono text-xs"
          defaultValue={currentNormalizedKey}
          onBlur={(e) => updateFilter("normalizedKey", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              updateFilter(
                "normalizedKey",
                (e.target as HTMLInputElement).value
              );
            }
          }}
        />
      </div>

      {/* Period range */}
      <div className="space-y-1.5">
        <Label className="text-xs">Période</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            defaultValue={currentPeriodStart}
            onBlur={(e) => updateFilter("periodStart", e.target.value)}
          />
          <Input
            type="date"
            defaultValue={currentPeriodEnd}
            onBlur={(e) => updateFilter("periodEnd", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
