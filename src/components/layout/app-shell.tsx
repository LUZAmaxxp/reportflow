/**
 * AppShell - Reusable layout wrapper for the dashboard
 * 
 * Combines the existing Sidebar and Topbar components with consistent styling.
 * Used as the main layout wrapper for authenticated pages.
 * 
 * Features:
 * - Dark mode design system (ESG platform colors)
 * - Collapsible sidebar with navigation
 * - Top bar with notifications and user menu
 * - Responsive layout using flexbox
 * - Proper spacing and typography using design tokens
 */

"use client";

import { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

/**
 * Note: The actual AppShell is implemented via the (app) layout.tsx
 * which uses SidebarProvider, Sidebar, Topbar, and SidebarInset components.
 * 
 * This file documents the pattern and can be used as a reference.
 * The layout in src/app/(app)/layout.tsx is the active implementation.
 */

export function AppShell({ children }: AppShellProps) {
  return <>{children}</>;
}
