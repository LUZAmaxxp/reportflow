"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ChatMessageContent,
  ManualObsRequestContent,
  ReportReadyContent,
  ErrorContent,
  AgentToolCallContent,
} from "@/types/chat";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ManualObsPopup } from "@/components/chat/ManualObsPopup";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

interface ChatMessage {
  message_id: string;
  type: string;
  content: ChatMessageContent;
  created_at?: string;
}

interface ChatShellProps {
  sessionId: string;
  initialMessages: ChatMessage[];
}

/**
 * Main chat interaction shell — Slice 5 §5.13
 * Maintains messages and streaming state, consumes SSE events,
 * manages Last-Event-ID reconnect, disables input while manual popup active.
 */
export function ChatShell({ sessionId, initialMessages }: ChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingObs, setPendingObs] = useState<ManualObsRequestContent | null>(null);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // SSE event handler — defined before connectStream so it can be referenced
  const handleSseEvent = useCallback((eventName: string, data: string) => {
    try {
      const payload = JSON.parse(data);

      switch (eventName) {
        case "token":
          setStreamingText((prev) => prev + payload.delta);
          break;

        case "tool_call":
          setMessages((prev) => [
            ...prev,
            {
              message_id: `tc-${Date.now()}`,
              type: "agent_tool_call",
              content: payload as AgentToolCallContent,
            },
          ]);
          break;

        case "manual_obs_request":
          setPendingObs(payload as ManualObsRequestContent);
          setIsPopupOpen(true);
          break;

        case "report_ready":
          setMessages((prev) => [
            ...prev,
            {
              message_id: `rr-${Date.now()}`,
              type: "report_ready",
              content: payload as ReportReadyContent,
            },
          ]);
          break;

        case "error":
          setMessages((prev) => [
            ...prev,
            {
              message_id: `err-${Date.now()}`,
              type: "error",
              content: payload as ErrorContent,
            },
          ]);
          break;

        case "done":
          // Flush streaming text to a message
          setStreamingText((prev) => {
            if (prev) {
              setMessages((msgs) => [
                ...msgs,
                {
                  message_id: `at-${Date.now()}`,
                  type: "agent_text",
                  content: { text: prev },
                },
              ]);
            }
            return "";
          });
          setIsStreaming(false);
          break;
      }
    } catch {
      // Ignore malformed SSE data
    }
  }, []);

  // SSE stream connection
  const connectStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.abort();
    }

    const controller = new AbortController();
    eventSourceRef.current = controller;

    const headers: Record<string, string> = {};
    if (lastEventIdRef.current) {
      headers["Last-Event-ID"] = lastEventIdRef.current;
    }

    const fetchStream = async () => {
      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        setIsStreaming(true);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentId: string | undefined;
          let currentEvent: string | undefined;

          for (const line of lines) {
            if (line.startsWith("id: ")) {
              currentId = line.slice(4).trim();
              lastEventIdRef.current = currentId;
            } else if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (currentEvent) {
                handleSseEvent(currentEvent, data);
              }
              currentEvent = undefined;
            } else if (line.startsWith(":")) {
              // Comment/heartbeat — ignore
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[ChatShell] Stream error:", err);
          // Reconnect after delay
          setTimeout(connectStream, 3000);
        }
      } finally {
        setIsStreaming(false);
      }
    };

    fetchStream();
  }, [sessionId, handleSseEvent]);

  // Fix #1: connect SSE stream on mount so server-initiated events are received
  useEffect(() => {
    connectStream();
    return () => {
      eventSourceRef.current?.abort();
    };
  }, [connectStream]);

  const handleSend = async () => {
    if (!inputText.trim() || isSending || isPopupOpen) return;

    const text = inputText.trim();
    setInputText("");
    setIsSending(true);

    // Optimistic add
    setMessages((prev) => [
      ...prev,
      {
        message_id: `user-${Date.now()}`,
        type: "user_text",
        content: { text },
      },
    ]);

    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        // Start listening for streaming response
        connectStream();
      }
    } catch (err) {
      console.error("[ChatShell] Send error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePopupClose = () => {
    setIsPopupOpen(false);
    setPendingObs(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 scroll-pb-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.message_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <MessageBubble message={msg} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming text indicator */}
        {streamingText && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap shadow-sm">
              {streamingText}
              <motion.span
                className="inline-block ml-0.5 text-primary"
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
              >
                ▌
              </motion.span>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="size-1.5 rounded-full bg-foreground/40"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacer for scroll padding */}
        <div className="h-1" aria-hidden />
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-3">
        {isPopupOpen && (
          <p className="text-xs text-muted-foreground italic mb-2">
            Veuillez compléter la donnée manuelle avant de continuer.
          </p>
        )}
        <div className="flex gap-2 items-end">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = "auto";
              target.style.height = target.scrollHeight + "px";
            }}
            placeholder="Tapez votre message..."
            disabled={isSending || isPopupOpen}
            className="flex-1 min-h-0 max-h-40 overflow-y-auto resize-none text-sm"
            maxLength={4000}
            rows={1}
          />
          <motion.div whileTap={{ scale: 0.95 }}>
            <Button
              onClick={handleSend}
              disabled={!inputText.trim() || isSending || isPopupOpen}
              size="sm"
            >
              Envoyer
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Manual observation popup */}
      {isPopupOpen && pendingObs && (
        <ManualObsPopup
          pendingId={pendingObs.pending_id}
          prefilled={pendingObs.prefilled}
          onClose={handlePopupClose}
        />
      )}
    </div>
  );
}
