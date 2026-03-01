"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatSession {
  session_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface SessionSidebarProps {
  activeSessionId?: string;
}

/**
 * List and create chat sessions — Slice 5 §5.13
 * Renders paginated sessions with updated_at ordering and button 'Nouvelle conversation'.
 */
export function SessionSidebar({ activeSessionId }: SessionSidebarProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchSessions = useCallback(async (pageNum: number) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/chat/sessions?page=${pageNum}&limit=20`);
      if (!res.ok) return;
      const data = await res.json();
      const sessions: ChatSession[] = data.data ?? [];
      if (pageNum === 1) {
        setSessions(sessions);
      } else {
        setSessions((prev) => [...prev, ...sessions]);
      }
      setHasMore(sessions.length === 20);
    } catch (err) {
      console.error("[SessionSidebar] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions(1);
  }, [fetchSessions]);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/chat/sessions", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      router.push(`/chat/${data.session_id}`);
    } catch (err) {
      console.error("[SessionSidebar] Create error:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchSessions(nextPage);
  };

  return (
    <div className="flex flex-col h-full w-64 border-r bg-background">
      <div className="p-3">
        <Button
          onClick={handleCreate}
          disabled={isCreating}
          className="w-full"
          size="sm"
        >
          {isCreating ? "Création..." : "Nouvelle conversation"}
        </Button>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto">
        {isLoading && sessions.length === 0 ? (
          <div className="space-y-1 p-1">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 h-full">
            <MessageSquare className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Aucune conversation</p>
            <Button
              onClick={handleCreate}
              disabled={isCreating}
              className="mt-3 w-full"
              size="sm"
              variant="secondary"
            >
              {isCreating ? "Création..." : "Nouvelle conversation"}
            </Button>
          </div>
        ) : (
          <ul className="space-y-0.5 p-1">
            <AnimatePresence>
              {sessions.map((s) => (
                <motion.li
                  key={s.session_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  <button
                    onClick={() => router.push(`/chat/${s.session_id}`)}
                    className={`group w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                      activeSessionId === s.session_id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="block truncate font-medium group-hover:text-foreground text-sm">
                      {s.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.message_count} message{s.message_count !== 1 ? "s" : ""}
                    </span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {hasMore && !isLoading && (
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadMore}
              className="w-full text-xs"
            >
              Charger plus
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
