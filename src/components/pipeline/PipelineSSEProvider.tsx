"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { PipelineEvent } from "@/lib/pipeline/events";

type EventHandler = (event: PipelineEvent) => void;

interface PipelineSSEContextValue {
  subscribe: (handler: EventHandler) => () => void;
  connected: boolean;
}

const PipelineSSEContext = createContext<PipelineSSEContextValue>({
  subscribe: () => () => {},
  connected: false,
});

export function usePipelineSSE() {
  return useContext(PipelineSSEContext);
}

interface PipelineSSEProviderProps {
  children: ReactNode;
}

/**
 * Maintains one EventSource per session to /api/pipeline/events.
 * Reconnect uses exponential backoff 1s..30s, sends Last-Event-ID
 * header when reconnecting, exposes subscribe/unsubscribe callbacks via React context.
 */
export default function PipelineSSEProvider({ children }: PipelineSSEProviderProps) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());
  const lastEventIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    let url = "/api/pipeline/events";
    // EventSource doesn't support custom headers, so we pass Last-Event-ID via query param
    if (lastEventIdRef.current) {
      url += `?lastEventId=${lastEventIdRef.current}`;
    }

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = 1000; // Reset backoff on success
    };

    // Listen for all event types
    const eventTypes = [
      "pipeline_stage_changed",
      "pipeline_failed",
      "extraction_complete",
      "observation_approved",
      "conflict_detected",
      "notification",
      "data_deletion_progress",
      "heartbeat",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const parsed: PipelineEvent = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId || String(parsed.id);

          // Notify all subscribers
          for (const handler of handlersRef.current) {
            handler(parsed);
          }
        } catch (err) {
          console.error("SSE parse error", err);
        }
      });
    }

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Exponential backoff reconnect 1s..30s
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30000);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const subscribe = useCallback((handler: EventHandler): (() => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <PipelineSSEContext.Provider value={{ subscribe, connected }}>
      {children}
    </PipelineSSEContext.Provider>
  );
}
