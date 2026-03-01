import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { chatSessions, chatMessages } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { ChatShell } from "@/components/chat/ChatShell";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active session chat page — Slice 5 §5.13
 * Loads session metadata, message history, and mounts ChatShell
 * with SSE stream lifecycle and reconnect semantics.
 */
export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { sessionId } = await params;
  if (!UUID_RE.test(sessionId)) notFound();

  const { user_id, company_id } = session.user;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify session ownership
    const [chatSession] = await tx
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.sessionId, sessionId),
          eq(chatSessions.userId, user_id)
        )
      )
      .limit(1);

    if (!chatSession) return null;

    // Load message history
    const messages = await tx
      .select({
        message_id: chatMessages.messageId,
        type: chatMessages.type,
        content: chatMessages.content,
        created_at: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));

    return { chatSession, messages };
  });

  if (!result) notFound();

  const initialMessages = result.messages.map((m: typeof result.messages[number]) => ({
    message_id: m.message_id,
    type: m.type,
    content: m.content as any,
    created_at: m.created_at?.toISOString?.() ?? String(m.created_at),
  }));

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6 bg-background">
      <SessionSidebar activeSessionId={sessionId} />
      <div className="flex-1 flex flex-col bg-gradient-to-br from-background via-muted/20 to-background">
        <ChatShell sessionId={sessionId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
