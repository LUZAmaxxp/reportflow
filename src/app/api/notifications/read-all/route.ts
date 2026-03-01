import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { notifications } from "@/lib/db/schema/notifications";
import { eq, and, sql, or, isNull } from "drizzle-orm";

/**
 * PATCH /api/notifications/read-all
 * MR-12 mark-all-read endpoint.
 * Sets read=true for unread notifications for session user in session company.
 * Idempotent when no unread rows exist.
 */
export async function PATCH(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { user_id, company_id } = session.user;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.companyId, company_id),
            or(
              eq(notifications.userId, user_id),
              isNull(notifications.userId)
            ),
            eq(notifications.read, false)
          )
        )
        .returning({ id: notifications.notificationId });

      return { updated_count: updated.length };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[PATCH /api/notifications/read-all] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
