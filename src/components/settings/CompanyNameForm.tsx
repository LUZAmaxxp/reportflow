"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PencilIcon, CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { fr } from "@/lib/messages/fr";

interface CompanyNameFormProps {
  companyId: string;
  initialName: string;
}

export default function CompanyNameForm({ companyId, initialName }: CompanyNameFormProps) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [originalName, setOriginalName] = useState(initialName);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      toast.error(fr.validation.maxLength.replace("{max}", "100"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        toast.error(fr.errors.generic);
        setName(originalName);
        return;
      }
      const data = await res.json();
      setName(data.name);
      setOriginalName(data.name);
      setEditing(false);
      toast.success(fr.settings.companySaved);
    } catch {
      toast.error(fr.errors.generic);
      setName(originalName);
    } finally {
      setSaving(false);
    }
  }, [name, companyId, originalName]);

  const handleCancel = () => {
    setName(originalName);
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{fr.settings.companyName}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Label htmlFor="company-name" className="sr-only">
            {fr.settings.companyName}
          </Label>
          {editing ? (
            <>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-sm"
                maxLength={100}
                autoFocus
              />
              <Button size="icon" variant="ghost" onClick={handleSave} disabled={saving}>
                <CheckIcon className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={handleCancel} disabled={saving}>
                <XIcon className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm">{name}</span>
              <Button size="icon" variant="ghost" onClick={() => setEditing(true)}>
                <PencilIcon className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
