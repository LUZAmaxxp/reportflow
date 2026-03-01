"use client";

import { motion, AnimatePresence } from "framer-motion";

interface BboxOverlayProps {
  activeBbox: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * Presentational SVG overlay component for evidence highlighting.
 * Renders SVG with viewBox="0 0 1 1" using normalized 0..1 coordinates.
 * Uses Framer Motion opacity transitions for fade in/out.
 */
export default function BboxOverlay({ activeBbox }: BboxOverlayProps) {
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 10 }}
    >
      <AnimatePresence>
        {activeBbox && (
          <motion.rect
            key={`${activeBbox.x1}-${activeBbox.y1}-${activeBbox.x2}-${activeBbox.y2}`}
            x={activeBbox.x1}
            y={activeBbox.y1}
            width={activeBbox.x2 - activeBbox.x1}
            height={activeBbox.y2 - activeBbox.y1}
            fill="rgba(59,130,246,0.2)"
            stroke="rgba(59,130,246,0.8)"
            strokeWidth={0.003}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>
    </svg>
  );
}
