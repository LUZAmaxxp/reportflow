import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { NewChatCTA } from "@/components/chat/NewChatCTA";

/**
 * Chat landing page with session sidebar and active/new session area — Slice 5 §5.13
 * Renders session list and empty-state prompts.
 * Supports creating a session and navigating to /chat/[sessionId].
 */
export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6">
      <SessionSidebar />
      <div className="flex-1 flex items-center justify-center">
        <NewChatCTA />
      </div>
    </div>
  );
}
