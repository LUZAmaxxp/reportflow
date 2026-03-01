"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { fr } from "@/lib/messages/fr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PreferencesSectionProps {
  userId: string;
  companyId: string;
}

export default function PreferencesSection({ userId, companyId }: PreferencesSectionProps) {
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences");
      if (!res.ok) return;
      const data = await res.json();
      setPreferences(data.preferences ?? {});
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleDeleteAll = async () => {
    try {
      const res = await fetch("/api/preferences", { method: "DELETE" });
      if (!res.ok) {
        toast.error(fr.errors.generic);
        return;
      }
      setPreferences({});
      toast.success(fr.settings.preferencesCleared);
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const entries = Object.entries(preferences);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{fr.settings.preferences}</CardTitle>
        {entries.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <TrashIcon className="mr-1 h-4 w-4" />
                {fr.settings.clearPreferences}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{fr.settings.clearPreferencesTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {fr.settings.clearPreferencesDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{fr.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAll}>
                  {fr.common.confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">{fr.common.loading}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{fr.settings.noPreferences}</p>
        ) : (
          <dl className="space-y-2">
            {entries.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-sm">
                <dt className="font-medium min-w-[120px]">{key}</dt>
                <dd className="text-muted-foreground">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
