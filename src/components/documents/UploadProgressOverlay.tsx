"use client";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface UploadProgressOverlayProps {
  isVisible: boolean;
  progress: number;
  isRetrying: boolean;
  error: string | null;
  onManualRetry: () => void;
  onDismiss: () => void;
}

/**
 * Shows percent progress during R2 PUT.
 * On 403 presigned-url expiry, auto-retries exactly once by requesting
 * /api/uploads/init and restarting PUT from 0%.
 * Displays French retry message during automatic retry and terminal French
 * error with manual retry button after second 403.
 * Non-403 errors stop immediately without automatic retry.
 */
export default function UploadProgressOverlay({
  isVisible,
  progress,
  isRetrying,
  error,
  onManualRetry,
  onDismiss,
}: UploadProgressOverlayProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-6 right-6 z-50 w-80 bg-background border border-border rounded-xl shadow-xl p-4"
        >
          {error ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="size-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onDismiss}>
                  Fermer
                </Button>
                <Button size="sm" onClick={onManualRetry}>
                  <RefreshCw className="mr-2 size-4" />
                  Réessayer
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {isRetrying
                    ? "Nouvelle tentative d'envoi en cours…"
                    : "Envoi du document en cours…"}
                </p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">
                  {Math.round(progress)}%
                </p>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
