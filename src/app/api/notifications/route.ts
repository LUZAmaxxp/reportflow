import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { notifications } from "@/lib/db/schema/notifications";
import { eq, and, sql, desc, or, isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id } = session.user;
  const url = new URL(req.url);

  const unreadParam = url.searchParams.get("unread");
  const pageStr = url.searchParams.get("page") ?? "1";
  const limitStr = url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "20";

  const page = parseInt(pageStr, 10);
  const limit = parseInt(limitStr, 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1) {
    return NextResponse.json({ code: "INVALID_QUERY", message: "page and limit must be positive integers" }, { status: 422 });
  }

  if (unreadParam !== null && unreadParam !== "true" && unreadParam !== "false") {
    return NextResponse.json({ code: "INVALID_QUERY", message: "unread must be true or false" }, { status: 422 });
  }

  const offset = (page - 1) * limit;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Ownership predicate: company_id=session.company_id AND (user_id=session.user_id OR user_id IS NULL)
      const ownershipConditions = [
        eq(notifications.companyId, company_id),
        or(
          eq(notifications.userId, user_id),
          isNull(notifications.userId)
        ),
      ];

      const conditions: any[] = [...ownershipConditions];

      if (unreadParam === "true") {
        conditions.push(eq(notifications.read, false));
      } else if (unreadParam === "false") {
        conditions.push(eq(notifications.read, true));
      }

      const whereClause = and(...conditions);
      const ownershipWhere = and(...ownershipConditions);

      // Count total
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(whereClause);

      const total = countRow?.count ?? 0;

      // Compute unreadCount with same ownership predicate
      const [unreadRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(ownershipWhere, eq(notifications.read, false)));

      const unreadCount = unreadRow?.count ?? 0;

      // Fetch notifications
      const rows = await tx
        .select({
          id: notifications.notificationId,
          type: notifications.type,
          payload: notifications.payload,
          read: notifications.read,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      const data = rows.map((r: any) => ({
        notification_id: r.id,
        type: r.type,
        payload: r.payload,
        read: r.read,
        created_at: r.createdAt?.toISOString(),
        user_id: null as string | null, // ownership already validated by query predicate
      }));

      return { data, total, unreadCount };
    });

    return NextResponse.json({
      data: result.data,
      total: result.total,
      unreadCount: result.unreadCount,
      page,
      pageSize: limit,
    });
  } catch (err) {
    console.error("[GET /api/notifications] Error:", err);
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Internal server error" }, { status: 500 });
  }
}
