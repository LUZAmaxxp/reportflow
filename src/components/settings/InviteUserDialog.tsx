"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { toast } from "sonner";
import { fr } from "@/lib/messages/fr";

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function InviteUserDialog({ open, onOpenChange, onCreated }: InviteUserDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setError(fr.validation.required);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(fr.validation.email);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "email_already_exists") {
          setError(fr.users.emailExists);
        } else if (body.code === "email_belongs_to_other_company") {
          setError(fr.users.emailOtherCompany);
        } else {
          setError(body.error ?? fr.errors.generic);
        }
        return;
      }
      toast.success(fr.users.created);
      onCreated();
      onOpenChange(false);
      setEmail("");
      setRole("editor");
    } catch {
      setError(fr.errors.generic);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-serif">{fr.users.inviteTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="user-email">{fr.users.email}</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                placeholder="nom@example.com"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">{fr.users.role}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Éditeur</SelectItem>
                  <SelectItem value="viewer">Lecteur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-border hover:bg-muted">
              {fr.common.cancel}
            </Button>
            <Button type="submit" disabled={saving} className="bg-accent hover:bg-accent/90 text-background">
              {saving ? fr.common.loading : fr.users.invite}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
