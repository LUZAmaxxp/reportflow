import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { chatSessions, chatMessages } from "@/lib/db/schema/notifications";
import { eq, desc, count, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/chat/sessions — Create a new chat session.
 */
export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { user_id, company_id, role } = session.user;

  if (!role || !["admin", "editor", "viewer"].includes(role)) {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient role" },
      { status: 403 }
    );
  }

  const result = await withTenant(db, company_id, async (tx) => {
    const [row] = await tx
      .insert(chatSessions)
      .values({
        companyId: company_id,
        userId: user_id,
        title: "Nouvelle conversation",
      })
      .returning({
        session_id: chatSessions.sessionId,
        created_at: chatSessions.createdAt,
      });
    return row;
  });

  return NextResponse.json(
    {
      session_id: result.session_id,
      created_at: result.created_at?.toISOString?.() ?? result.created_at,
    },
    { status: 201 }
  );
}

/**
 * GET /api/chat/sessions — List user's chat sessions paginated.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { user_id, company_id, role } = session.user;

  if (!role || !["admin", "editor", "viewer"].includes(role)) {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient role" },
      { status: 403 }
    );
  }
  const searchParams = req.nextUrl.searchParams;

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);

  if (isNaN(page) || page < 1) {
    return NextResponse.json(
      { code: "invalid_query", message: "page must be >= 1" },
      { status: 422 }
    );
  }
  if (isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { code: "invalid_query", message: "limit must be 1..100" },
      { status: 422 }
    );
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    // Fetch sessions with message count
    const rows = await tx
      .select({
        session_id: chatSessions.sessionId,
        title: chatSessions.title,
        created_at: chatSessions.createdAt,
        updated_at: chatSessions.updatedAt,
        message_count: sql<number>`(SELECT count(*) FROM chat_message WHERE session_id = ${chatSessions.sessionId})::int`,
      })
      .from(chatSessions)
      .where(eq(chatSessions.userId, user_id))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r: typeof rows[number]) => ({
      session_id: r.session_id,
      title: r.title,
      created_at: r.created_at?.toISOString?.() ?? r.created_at,
      updated_at: r.updated_at?.toISOString?.() ?? r.updated_at,
      message_count: Number(r.message_count),
    }));
  });

  return NextResponse.json({
    data: result,
    page,
    pageSize: limit,
  });
}
