"use client";

import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  FileTextIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NotificationData {
  notification_id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
  user_id: string;
}

interface NotificationItemProps {
  notification: NotificationData;
  onMarkRead: (id: string) => void;
}

const typeConfig: Record<string, { icon: typeof AlertTriangleIcon; label: string; href: string }> = {
  pipeline_completed: { icon: ZapIcon, label: "Pipeline terminé", href: "/documents" },
  pipeline_done: { icon: ZapIcon, label: "Pipeline terminé", href: "/documents" },
  pipeline_failed: { icon: AlertTriangleIcon, label: "Erreur pipeline", href: "/documents" },
  conflict_detected: { icon: AlertTriangleIcon, label: "Conflit détecté", href: "/conflicts" },
  conflict_resolved: { icon: CheckCircleIcon, label: "Conflit résolu", href: "/conflicts" },
  report_ready: { icon: FileTextIcon, label: "Rapport prêt", href: "/reports" },
  manual_obs_requested: { icon: ZapIcon, label: "Observation demandée", href: "/observations" },
};

export default function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const router = useRouter();
  const config = typeConfig[notification.type] ?? {
    icon: ZapIcon,
    label: notification.type,
    href: "/",
  };
  const Icon = config.icon;

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(notification.created_at), {
        addSuffix: true,
        locale: fr,
      });
    } catch {
      return "";
    }
  })();

  const handleClick = () => {
    if (!notification.read) {
      onMarkRead(notification.notification_id);
    }
    router.push(config.href);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
        !notification.read && "bg-muted/30"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", !notification.read && "font-medium")}>
          {config.label}
        </p>
        <p className="text-xs text-muted-foreground">{timeAgo}</p>
      </div>
      {!notification.read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
      )}
    </button>
  );
}
