"use client";

import { useState } from "react";
import CompanyNameForm from "@/components/settings/CompanyNameForm";
import PreferencesSection from "@/components/settings/PreferencesSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { AlertTriangleIcon, UsersIcon, FolderTreeIcon } from "lucide-react";
import { toast } from "sonner";
import { fr } from "@/lib/messages/fr";
import Link from "next/link";

interface SettingsClientProps {
  companyId: string;
  userId: string;
  role: "admin" | "editor";
}

export default function SettingsClient({ companyId, userId, role }: SettingsClientProps) {
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteCompanyData = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/data`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (res.status === 202) {
        toast.success(fr.settings.deletionStarted);
      } else {
        toast.error(fr.errors.generic);
      }
    } catch {
      toast.error(fr.errors.generic);
    } finally {
      setDeleting(false);
      setConfirmName("");
    }
  };

  return (
    <div className="space-y-6">
      <CompanyNameForm companyId={companyId} initialName="" />

      <PreferencesSection userId={userId} companyId={companyId} />

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-2">
        {role === "admin" && (
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <UsersIcon className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">{fr.settings.teamManagement}</p>
                <p className="text-xs text-muted-foreground">{fr.settings.teamDescription}</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/users">{fr.common.manage}</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <FolderTreeIcon className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">{fr.settings.categoryManagement}</p>
              <p className="text-xs text-muted-foreground">{fr.settings.categoryDescription}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/categories">{fr.common.manage}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Danger zone — admin only */}
      {role === "admin" && (
        <>
          <Separator />
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive text-base">
                <AlertTriangleIcon className="h-4 w-4" />
                {fr.settings.dangerZone}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {fr.settings.dangerDescription}
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">{fr.settings.deleteAllData}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{fr.settings.deleteConfirmTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {fr.settings.deleteConfirmDescription}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="py-4 space-y-2">
                    <Label htmlFor="confirm-company-name">
                      {fr.settings.confirmCompanyName}
                    </Label>
                    <Input
                      id="confirm-company-name"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={fr.settings.companyNamePlaceholder}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{fr.common.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteCompanyData}
                      disabled={!confirmName.trim() || deleting}
                    >
                      {deleting ? fr.common.loading : fr.settings.confirmDelete}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
