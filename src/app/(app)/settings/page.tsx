import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fr } from "@/lib/messages/fr";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.company_id || !session?.user?.user_id) {
    redirect("/login");
  }

  const role = session.user.role;
  if (role === "viewer") {
    redirect("/");
  }

  return (
    <section className="grid gap-6 max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">
        {fr.settings.title}
      </h1>
      <SettingsClient
        companyId={session.user.company_id}
        userId={session.user.user_id}
        role={role as "admin" | "editor"}
      />
    </section>
  );
}
