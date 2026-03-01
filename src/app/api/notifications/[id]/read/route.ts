import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { notifications } from "@/lib/db/schema/notifications";
import { eq, and, or, isNull } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id } = session.user;
  const { id: notificationId } = await params;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Validate ownership and tenant scope
      const [notif] = await tx
        .select({ id: notifications.notificationId })
        .from(notifications)
        .where(
          and(
            eq(notifications.notificationId, notificationId),
            eq(notifications.companyId, company_id),
            or(
              eq(notifications.userId, user_id),
              isNull(notifications.userId)
            )
          )
        )
        .limit(1);

      if (!notif) {
        return { error: "not_found" };
      }

      // Update read=true
      await tx
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.notificationId, notificationId));

      return { id: notificationId, read: true };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: "Notification not found in accessible scope" },
        { status: 404 }
      );
    }

    // TODO: verify - PATCH /api/notifications/{id}/read returns 200 { read: true } and later unread query excludes it
    return NextResponse.json({ notification_id: result.id, read: result.read });
  } catch (err) {
    console.error("[PATCH /api/notifications/[id]/read] Error:", err);
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Internal server error" }, { status: 500 });
  }
}
