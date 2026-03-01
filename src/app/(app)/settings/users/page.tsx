import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fr } from "@/lib/messages/fr";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user?.company_id || !session?.user?.user_id) {
    redirect("/login");
  }

  if (session.user.role !== "admin") {
    redirect("/settings");
  }

  return (
    <section className="grid gap-6 max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight">
        {fr.users.title}
      </h1>
      <UsersClient userId={session.user.user_id} />
    </section>
  );
}
