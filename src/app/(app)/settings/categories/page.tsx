import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fr } from "@/lib/messages/fr";
import CategoriesClient from "./CategoriesClient";

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user?.company_id) {
    redirect("/login");
  }

  if (session.user.role === "viewer") {
    redirect("/");
  }

  // Fetch initial categories server-side
  let initialCategories: any[] = [];
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/categories`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      initialCategories = data.categories ?? [];
    }
  } catch {}

  return (
    <section className="grid gap-6 max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight text-foreground font-serif">
        {fr.categories.title}
      </h1>
      <CategoriesClient initialCategories={initialCategories} />
    </section>
  );
}
