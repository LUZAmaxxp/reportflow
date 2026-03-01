"use client";

import ReactMarkdown from "react-markdown";
import type { ChatMessageContent } from "@/types/chat";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { ManualObsCard } from "@/components/chat/ManualObsCard";
import { ReportReadyCard } from "@/components/chat/ReportReadyCard";

interface ChatMessage {
  message_id: string;
  type: string;
  content: ChatMessageContent;
  created_at?: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * Type-dispatched message renderer — Slice 5 §5.13
 * Renders user_text right-aligned plain text, agent_text left-aligned markdown,
 * delegates other message types to specialized cards.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const { type, content } = message;

  // User messages: right-aligned plain text
  if (type === "user_text" && "text" in content) {
    return (
      <div className="flex justify-end">
        <div className="bg-primary/90 text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap shadow-sm">
          {content.text}
        </div>
      </div>
    );
  }

  // Agent text: left-aligned with markdown support
  if (type === "agent_text" && "text" in content) {
    return (
      <div className="flex justify-start">
        <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] prose prose-sm dark:prose-invert prose-p:my-1 prose-p:leading-relaxed prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 shadow-sm">
          <ReactMarkdown>{content.text}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // Tool call: collapsed card
  if (type === "agent_tool_call" && "tool_name" in content) {
    return (
      <div className="flex justify-start">
        <ToolCallCard
          toolName={content.tool_name}
          summary={content.summary}
          details={(content as any).details}
        />
      </div>
    );
  }

  // Manual observation request: inline card
  if (type === "manual_obs_request" && "pending_id" in content) {
    return (
      <div className="flex justify-start">
        <ManualObsCard
          pendingId={content.pending_id}
          prefilled={content.prefilled}
        />
      </div>
    );
  }

  // Report ready: navigation card
  if (type === "report_ready" && "report_id" in content) {
    return (
      <div className="flex justify-start">
        <ReportReadyCard
          reportId={content.report_id}
          title={content.title}
          htmlSnapshotUrl={content.html_snapshot_url}
          pdfUrl={content.pdf_url}
        />
      </div>
    );
  }

  // Error: left-aligned error message
  if (type === "error" && "message" in content) {
    return (
      <div className="flex justify-start">
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%]">
          <p className="text-sm font-medium">Erreur</p>
          <p className="text-sm">{(content as any).message}</p>
          {(content as any).retryable && (
            <p className="text-xs mt-1 text-muted-foreground">
              Cette erreur peut être réessayée.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Fallback: unknown message type
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] text-sm text-muted-foreground">
        Message non reconnu
      </div>
    </div>
  );
}
