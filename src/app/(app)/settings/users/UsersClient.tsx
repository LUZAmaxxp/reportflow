"use client";

import { useState, useCallback } from "react";
import UserTable from "@/components/settings/UserTable";
import InviteUserDialog from "@/components/settings/InviteUserDialog";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { fr } from "@/lib/messages/fr";

interface UsersClientProps {
  userId: string;
}

export default function UsersClient({ userId }: UsersClientProps) {
  const [showInvite, setShowInvite] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setShowInvite(true)}>
          <PlusIcon className="mr-1 h-4 w-4" />
          {fr.users.invite}
        </Button>
      </div>

      <UserTable key={refreshKey} currentUserId={userId} />

      <InviteUserDialog
        open={showInvite}
        onOpenChange={setShowInvite}
        onCreated={handleCreated}
      />
    </div>
  );
}
