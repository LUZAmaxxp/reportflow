import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import ConflictInboxPage from "@/components/conflicts/ConflictInboxPage";

export default async function ConflictsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Server-side initial fetch to avoid loading flash
  let initialData;
  try {
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const protocol = headersList.get("x-forwarded-proto") ?? "http";
    const cookie = headersList.get("cookie") ?? "";
    const res = await fetch(`${protocol}://${host}/api/conflicts?page=1&limit=20`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (res.ok) {
      initialData = await res.json();
    }
  } catch {
    // Fall back to client-side fetch
  }

  return <ConflictInboxPage initialData={initialData} />;
}
