"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboardIcon,
  FileTextIcon,
  EyeIcon,
  AlertTriangleIcon,
  ClipboardListIcon,
  MessageCircleIcon,
  SettingsIcon,
} from "lucide-react";

import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarFooter,
  SidebarRail,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import NavItem from "@/components/layout/NavItem";
import Link from "next/link";
import { usePathname } from "next/navigation";

type UserRole = "admin" | "editor" | "viewer";

const allNavItems = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboardIcon, roles: ["admin", "editor", "viewer"] as UserRole[] },
  { href: "/documents", label: "Documents", icon: FileTextIcon, roles: ["admin", "editor", "viewer"] as UserRole[] },
  { href: "/observations", label: "Observations", icon: EyeIcon, roles: ["admin", "editor", "viewer"] as UserRole[] },
  { href: "/reports", label: "Rapports", icon: ClipboardListIcon, roles: ["admin", "editor", "viewer"] as UserRole[] },
  { href: "/chat", label: "Chat", icon: MessageCircleIcon, roles: ["admin", "editor"] as UserRole[] },
  { href: "/settings", label: "Paramètres", icon: SettingsIcon, roles: ["admin"] as UserRole[] },
];

interface SidebarProps {
  role?: UserRole;
}

export default function Sidebar({ role = "viewer" }: SidebarProps) {
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const pathname = usePathname();
  const conflictActive = pathname === "/conflicts" || pathname.startsWith("/conflicts");

  // Filter nav items by role
  const navItems = allNavItems.filter((item) => item.roles.includes(role));

  // Editor can access category management via settings/categories
  const showCategoriesLink = role === "editor";

  const fetchUnresolved = useCallback(async () => {
    try {
      const res = await fetch("/api/conflicts?resolutionStatus=auto_resolved&limit=1");
      if (!res.ok) return;
      const data = await res.json();
      setUnresolvedCount(data.total ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnresolved();
  }, [fetchUnresolved]);

  // Listen for conflict_detected SSE events
  useEffect(() => {
    const eventSource = new EventSource("/api/pipeline/events");
    eventSource.addEventListener("conflict_detected", () => {
      setUnresolvedCount((prev) => prev + 1);
    });
    return () => eventSource.close();
  }, []);

  // Conflicts visible to admin and editor only
  const showConflicts = role === "admin" || role === "editor";

  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="flex items-center px-4 py-3">
        <span className="text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">
          ReportFlow
        </span>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                />
              ))}
              {showCategoriesLink && (
                <NavItem
                  href="/settings/categories"
                  label="Catégories"
                  icon={SettingsIcon}
                />
              )}
              {/* Conflicts nav item with badge */}
              {showConflicts && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={conflictActive} tooltip="Conflits">
                    <Link href="/conflicts">
                      <AlertTriangleIcon />
                      <span>Conflits</span>
                    </Link>
                  </SidebarMenuButton>
                  {unresolvedCount > 0 && (
                    <SidebarMenuBadge>{unresolvedCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
      <SidebarRail />
    </ShadcnSidebar>
  );
}
