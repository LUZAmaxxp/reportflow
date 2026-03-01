import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { DashboardSummaryResponse } from "@/types/dashboard";
import { fr } from "@/lib/messages/fr";
import DashboardClient from "@/app/(app)/DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.company_id) {
    redirect("/login");
  }

  // Server-side fetch for dashboard summary
  let data: DashboardSummaryResponse | null = null;
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/dashboard/summary`, {
      headers: { cookie: "" }, // RSC internal fetch — relies on forwarded auth
      cache: "no-store",
    });
    if (res.ok) {
      data = await res.json();
    }
  } catch {
    // Fallback: will show empty state
  }

  return (
    <section className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground font-serif">
          {fr.dashboard.title}
        </h1>
      </div>
      <DashboardClient initialData={data} />
    </section>
  );
}
