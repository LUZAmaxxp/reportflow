"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Client-side CTA for the chat landing empty state — creates a new session
 * and redirects to it. Extracted to keep the parent page as a server component.
 */
export function NewChatCTA() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/chat/sessions", { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      router.push(`/chat/${data.session_id}`);
    } catch (err) {
      console.error("[NewChatCTA] Create error:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="text-center max-w-sm px-4"
    >
      <MessageSquare className="size-12 text-muted-foreground mx-auto mb-4" />
      <h2 className="text-xl font-semibold">Démarrez une conversation</h2>
      <p className="text-muted-foreground text-sm mt-2 mb-6">
        Sélectionnez une conversation existante ou créez-en une nouvelle
        pour commencer à générer vos rapports ESG.
      </p>
      <Button onClick={handleCreate} disabled={isCreating}>
        {isCreating ? "Création..." : "Nouvelle conversation"}
      </Button>
    </motion.div>
  );
}
