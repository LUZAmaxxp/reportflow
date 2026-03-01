import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { chatSessions, chatMessages } from "@/lib/db/schema/notifications";
import { eq, and, asc, count } from "drizzle-orm";
import { agentLoopQueue } from "@/lib/queues";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/chat/sessions/{id}/messages — Create a user message and dispatch agent turn.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: "session_not_found", message: "Session not found" },
      { status: 404 }
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_body", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.text || typeof body.text !== "string") {
    return NextResponse.json(
      { code: "invalid_body", message: "text is required" },
      { status: 400 }
    );
  }

  if (body.text.length < 1) {
    return NextResponse.json(
      { code: "invalid_body", message: "text must be at least 1 character" },
      { status: 400 }
    );
  }

  if (body.text.length > 4000) {
    return NextResponse.json(
      { code: "text_too_long", message: "text must be at most 4000 characters" },
      { status: 422 }
    );
  }

  const { user_id, company_id } = session.user;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify session ownership
    const [chatSession] = await tx
      .select({
        sessionId: chatSessions.sessionId,
        userId: chatSessions.userId,
      })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.sessionId, id),
          eq(chatSessions.userId, user_id)
        )
      )
      .limit(1);

    if (!chatSession) {
      return { error: "session_not_found" as const };
    }

    // Insert user message
    const [message] = await tx
      .insert(chatMessages)
      .values({
        sessionId: id,
        role: "user",
        type: "user_text",
        content: { text: body.text },
      })
      .returning({ message_id: chatMessages.messageId });

    // Check if this is the first message and update title
    const [{ total }] = await tx
      .select({ total: count() })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id));

    if (Number(total) === 1) {
      const truncatedTitle = body.text!.slice(0, 60);
      await tx
        .update(chatSessions)
        .set({
          title: truncatedTitle,
          updatedAt: new Date(),
        })
        .where(eq(chatSessions.sessionId, id));
    } else {
      await tx
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.sessionId, id));
    }

    return { message_id: message.message_id };
  });

  if ("error" in result) {
    return NextResponse.json(
      { code: "session_not_found", message: "Session not found or not owned by user" },
      { status: 404 }
    );
  }

  // Enqueue agent loop job via BullMQ
  await agentLoopQueue.add(
    "agent-turn",
    {
      session_id: id,
      user_message_id: result.message_id,
      mode: "normal",
      report_id: null,
    },
    { attempts: 1, jobId: `agent-loop-${result.message_id}` }
  );

  return NextResponse.json(
    { message_id: result.message_id },
    { status: 202 }
  );
}

/**
 * GET /api/chat/sessions/{id}/messages — List messages in a session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: "session_not_found", message: "Session not found" },
      { status: 404 }
    );
  }

  const { user_id, company_id } = session.user;
  const searchParams = req.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { code: "invalid_query", message: "Invalid pagination params" },
      { status: 422 }
    );
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify session ownership
    const [chatSession] = await tx
      .select({ sessionId: chatSessions.sessionId })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.sessionId, id),
          eq(chatSessions.userId, user_id)
        )
      )
      .limit(1);

    if (!chatSession) {
      return { error: "session_not_found" as const };
    }

    const rows = await tx
      .select({
        message_id: chatMessages.messageId,
        type: chatMessages.type,
        content: chatMessages.content,
        created_at: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r: typeof rows[number]) => ({
        message_id: r.message_id,
        type: r.type,
        content: r.content,
      })),
    };
  });

  if ("error" in result) {
    return NextResponse.json(
      { code: "session_not_found", message: "Session not found or not owned by user" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: result.data,
    page,
    pageSize: limit,
  });
}
