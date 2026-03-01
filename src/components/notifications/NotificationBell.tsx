"use client";

import { useCallback, useEffect, useState } from "react";
import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import NotificationItem from "@/components/notifications/NotificationItem";

interface NotificationData {
  notification_id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
  user_id: string;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=true&pageSize=20");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.data ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch (err) {
      console.error("[NotificationBell] fetch error", err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Subscribe to existing pipeline SSE stream for notification events
  useEffect(() => {
    const eventSource = new EventSource("/api/pipeline/events");

    eventSource.addEventListener("notification", (e) => {
      try {
        const event = JSON.parse(e.data);
        setUnreadCount(event.unreadCount ?? ((prev: number) => prev + 1));
        setNotifications((prev) => [
          {
            notification_id: event.notificationId,
            type: event.notificationType,
            payload: event.payload ?? {},
            read: false,
            created_at: event.timestamp,
            user_id: "",
          },
          ...prev,
        ]);
      } catch {}
    });

    return () => eventSource.close();
  }, []);
  // TODO: verify - Notification bell badge increments on notification SSE without page reload

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "PATCH" });
    } catch {}
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) =>
        prev.map((n) => (n.notification_id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {}
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative hover:bg-muted/50">
          <BellIcon className="h-5 w-5 text-foreground" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 min-w-[20px] rounded-full px-1 text-xs bg-red-500 text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-card border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-semibold text-foreground font-serif">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={handleMarkAllRead}
            >
              Tout marquer comme lu
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Aucune notification
            </p>
          ) : (
            notifications.map((notif) => (
              <NotificationItem
                key={notif.notification_id}
                notification={notif}
                onMarkRead={handleMarkRead}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
