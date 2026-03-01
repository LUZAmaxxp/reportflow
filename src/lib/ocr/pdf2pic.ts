import { createCanvas } from "@napi-rs/canvas";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as path from "path";

export interface PageImage {
  pageNumber: number;
  buffer: Buffer;
  width: number;
  height: number;
}

const DPI = 300;
const SCALE = DPI / 72; // 72 is the PDF default DPI

/**
 * Converts PDF buffers to per-page PNG at 150 DPI using pdfjs-dist + @napi-rs/canvas.
 * Image uploads are treated as single-page input.
 * No system-level dependencies required (replaces pdf2pic which needs GraphicsMagick).
 */
export async function convertToPageImages(
  fileBuffer: Buffer,
  mimeType: string,
  _expectedPageCount: number
): Promise<PageImage[]> {
  if (mimeType !== "application/pdf") {
    // For images, use @napi-rs/canvas to read dimensions
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(fileBuffer);
    return [
      {
        pageNumber: 1,
        buffer: fileBuffer,
        width: img.width,
        height: img.height,
      },
    ];
  }

  // Load PDF using pdfjs-dist (works in Node.js via legacy build)
  // standardFontDataUrl is required so pdfjs can load Helvetica metrics
  // for correct character spacing during canvas rendering.
  // pdfjs-dist validates that the URL uses forward slashes, so we
  // convert the native path to a file:// URL.
  const fontsDir = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts"
  );
  const standardFontDataUrl = "file:///" + fontsDir.replace(/\\/g, "/") + "/";

  const pdfDoc: PDFDocumentProxy = await getDocument({
    data: new Uint8Array(fileBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    standardFontDataUrl,
  }).promise;

  const pages: PageImage[] = [];

  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });

      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // pdfjs render expects a CanvasRenderingContext2D-like object
      // We cast canvas/ctx to satisfy the RenderParameters type
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;

      const pngBuffer = canvas.toBuffer("image/png");

      pages.push({
        pageNumber: i,
        buffer: Buffer.from(pngBuffer),
        width,
        height,
      });

      page.cleanup();
    }
  } finally {
    await pdfDoc.destroy();
  }

  return pages;
}
