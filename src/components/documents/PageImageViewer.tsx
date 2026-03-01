"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import BboxOverlay from "./BboxOverlay";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PageImageViewerProps {
  documentId: string;
  pageNumber: number;
  activeBbox: { x1: number; y1: number; x2: number; y2: number } | null;
  onPrevPage: () => void;
  onNextPage: () => void;
  currentPage: number;
  totalPages: number;
}

/**
 * Client component responsible for page image rendering and overlay mount point.
 * Fetches page image from GET /api/documents/{id}/pages/{pageNumber}.
 */
export default function PageImageViewer({
  documentId,
  pageNumber,
  activeBbox,
  onPrevPage,
  onNextPage,
  currentPage,
  totalPages,
}: PageImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchPage() {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/pages/${pageNumber}`
        );
        if (!response.ok) {
          throw new Error(`Erreur de chargement de la page ${pageNumber}`);
        }
        const data = await response.json();
        if (!cancelled) {
          setImageUrl(data.pageImageUrl ?? data.url ?? data.imageUrl ?? null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Erreur de chargement de la page"
          );
          setLoading(false);
        }
      }
    }

    fetchPage();
    return () => {
      cancelled = true;
    };
  }, [documentId, pageNumber]);

  return (
    <div className="flex flex-col h-full">
      {/* Page navigation controls */}
      <div className="flex items-center justify-between px-2 py-2 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevPage}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentPage} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onNextPage}
          disabled={currentPage >= totalPages}
        >
          Suivant
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Image container */}
      <div className="flex-1 relative overflow-hidden bg-muted/30 flex items-center justify-center">
        {loading && (
          <div className="p-8 w-full">
            <Skeleton className="w-full h-96" />
            <p className="text-center text-sm text-muted-foreground mt-2">
              Chargement de la page…
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="text-center text-sm text-destructive p-8">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && imageUrl && (
          <ImageWithOverlay
            imageUrl={imageUrl}
            pageNumber={pageNumber}
            activeBbox={activeBbox}
          />
        )}

        {!loading && !error && !imageUrl && (
          <div className="text-center text-sm text-muted-foreground p-8">
            <p>Aucune image disponible pour cette page</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inner component that uses a ResizeObserver on the container and the image's
 * natural dimensions to compute the exact pixel rectangle the image occupies.
 * Both the <img> and the SVG overlay are sized to that rectangle — no
 * object-contain, no letterbox gap, pixel-perfect alignment.
 */
function ImageWithOverlay({
  imageUrl,
  pageNumber,
  activeBbox,
}: {
  imageUrl: string;
  pageNumber: number;
  activeBbox: { x1: number; y1: number; x2: number; y2: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [fitted, setFitted] = useState<{ width: number; height: number } | null>(null);

  // Measure image natural dimensions once loaded
  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, []);

  // Recompute fitted size whenever the container resizes or natural size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !naturalSize) return;

    function computeFit() {
      if (!container || !naturalSize) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      const imgAspect = naturalSize.w / naturalSize.h;
      const containerAspect = cw / ch;

      let fitW: number;
      let fitH: number;
      if (imgAspect > containerAspect) {
        // Image wider than container → constrained by width
        fitW = cw;
        fitH = cw / imgAspect;
      } else {
        // Image taller than container → constrained by height
        fitH = ch;
        fitW = ch * imgAspect;
      }

      setFitted({ width: Math.round(fitW), height: Math.round(fitH) });
    }

    computeFit();

    const ro = new ResizeObserver(computeFit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [naturalSize]);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {/* Wrapper sized to exactly the fitted image dimensions */}
      <div
        className="relative"
        style={
          fitted
            ? { width: fitted.width, height: fitted.height }
            : { width: "100%", height: "100%" }
        }
      >
        {/* Hidden img to detect natural dimensions before fitted size is known */}
        {!naturalSize && (
          <img
            src={imageUrl}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-contain"
            onLoad={handleLoad}
          />
        )}
        {/* Once we know the fitted size, render img without object-contain */}
        {naturalSize && (
          <>
            <img
              src={imageUrl}
              alt={`Page ${pageNumber}`}
              className="block w-full h-full"
              draggable={false}
            />
            <BboxOverlay activeBbox={activeBbox} />
          </>
        )}
      </div>
    </div>
  );
}
