"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

interface ToolCallCardProps {
  toolName: string;
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Collapsed card for tool invocation messages — Slice 5 §5.13
 * Shows tool_name and summary by default with optional expandable details.
 */
export function ToolCallCard({ toolName, summary, details }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="max-w-[80%] cursor-pointer py-0 gap-0" onClick={() => setExpanded(!expanded)}>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono shrink-0">
            {toolName}
          </Badge>
          <CardTitle className="text-sm font-normal truncate">{summary}</CardTitle>
        </div>
      </CardHeader>
      {details && (
        <CardContent className="pt-0 px-3 pb-2">
          <motion.div
            initial={false}
            animate={{
              height: expanded ? "auto" : 0,
              opacity: expanded ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
              {JSON.stringify(details, null, 2)}
            </pre>
          </motion.div>
        </CardContent>
      )}
    </Card>
  );
}
