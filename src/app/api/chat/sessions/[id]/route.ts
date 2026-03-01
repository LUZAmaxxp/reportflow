import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { chatSessions } from "@/lib/db/schema/notifications";
import { eq, and } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/chat/sessions/{id} — Delete a chat session and cascade messages.
 */
export async function DELETE(
  _req: NextRequest,
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

  const deleted = await withTenant(db, company_id, async (tx) => {
    const result = await tx
      .delete(chatSessions)
      .where(
        and(
          eq(chatSessions.sessionId, id),
          eq(chatSessions.userId, user_id)
        )
      )
      .returning({ session_id: chatSessions.sessionId });
    return result.length > 0;
  });

  if (!deleted) {
    return NextResponse.json(
      { code: "session_not_found", message: "Session not found or not owned by user" },
      { status: 404 }
    );
  }

  // FK ON DELETE CASCADE handles chat_message cleanup
  return new NextResponse(null, { status: 204 });
}
