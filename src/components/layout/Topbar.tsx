"use client";

import { signOut } from "next-auth/react";
import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import NotificationBell from "@/components/notifications/NotificationBell";

interface TopbarProps {
  companyName: string;
  userEmail?: string;
}

export default function Topbar({ companyName, userEmail }: TopbarProps) {
  const initials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : "RF";

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-card px-4">
      <SidebarTrigger />

      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar size="sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOutIcon />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
