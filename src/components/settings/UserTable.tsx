"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface User {
  user_id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  created_at: string;
}

interface UserTableProps {
  currentUserId: string;
}

export default function UserTable({ currentUserId }: UserTableProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users?page=${page}&pageSize=${pageSize}`);
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "last_admin") {
          toast.error(fr.users.lastAdminError);
        } else {
          toast.error(fr.errors.generic);
        }
        return;
      }
      toast.success(fr.users.roleUpdated);
      await fetchUsers();
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "last_admin") {
          toast.error(fr.users.lastAdminError);
        } else if (body.code === "cannot_delete_self") {
          toast.error(fr.users.cannotDeleteSelf);
        } else {
          toast.error(fr.errors.generic);
        }
        return;
      }
      toast.success(fr.users.deleted);
      await fetchUsers();
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{fr.users.email}</TableHead>
            <TableHead>{fr.users.role}</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                {fr.common.loading}
              </TableCell>
            </TableRow>
          ) : users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                {fr.users.empty}
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.user_id} className="border-border hover:bg-muted/20">
                <TableCell className="font-medium text-accent">{user.email}</TableCell>
                <TableCell>
                  <Select
                    value={user.role}
                    onValueChange={(val) => handleRoleChange(user.user_id, val)}
                  >
                    <SelectTrigger className="w-[120px] bg-muted/30 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="editor">Éditeur</SelectItem>
                      <SelectItem value="viewer">Lecteur</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {user.user_id !== currentUserId && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive">
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-foreground font-serif">{fr.users.deleteTitle}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {fr.users.deleteDescription.replace("{email}", user.email)}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{fr.common.cancel}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(user.user_id)}>
                            {fr.common.confirm}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {fr.common.previous}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {fr.common.next}
          </Button>
        </div>
      )}
    </div>
  );
}
