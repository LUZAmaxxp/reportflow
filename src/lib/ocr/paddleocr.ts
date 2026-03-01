import { env } from "@/lib/env";

// ─── PP-OCRv5 response types ────────────────────────────────────────

/** Per-page OCR result from PP-OCRv5 */
export interface PaddleOCRPageResult {
  prunedResult: {
    rec_texts: string[];
    rec_scores: number[];
    dt_polys: number[][][]; // Each entry is a 4-corner polygon [[x,y], ...]
    input_img_height?: number;
    input_img_width?: number;
  };
  ocrImage?: string;
}

export interface PaddleOCRResponse {
  result?: {
    ocrResults?: PaddleOCRPageResult[];
  };
  errorCode: number;
  errorMsg: string;
}

/** Flattened OCR box for downstream consumption */
export interface PaddleOCRBox {
  text: string;
  confidence: number;
  box: number[][];
}

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends per-page base64 PNG to PP-OCRv5 API.
 * Returns per-line text boxes with tight polygon bboxes.
 * Includes retry with exponential backoff for 429 rate-limit responses.
 */
export async function ocrPage(pageBuffer: Buffer): Promise<PaddleOCRBox[]> {
  const base64Image = pageBuffer.toString("base64");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(env.PADDLEOCR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${env.PADDLEOCR_TOKEN}`,
      },
      body: JSON.stringify({
        file: base64Image,
        fileType: 1, // 0 = PDF, 1 = image
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (response.status === 429) {
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`PaddleOCR 429 rate-limited, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }
      throw new Error(`PaddleOCR API rate-limited after ${MAX_RETRIES} retries`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`PaddleOCR API error ${response.status}: ${text}`);
    }

    const data: PaddleOCRResponse = await response.json();

    if (data.errorCode !== 0) {
      throw new Error(`PaddleOCR error ${data.errorCode}: ${data.errorMsg ?? "unknown"}`);
    }

    // Map PP-OCRv5 response to flat PaddleOCRBox[] for downstream use
    return mapOCRv5ToBoxes(data);
  }

  // Unreachable, but TypeScript needs it
  throw new Error("PaddleOCR: unexpected retry loop exit");
}

/**
 * Maps PP-OCRv5 response into flat PaddleOCRBox[] records.
 * Each entry is a single text line with its 4-corner polygon bbox and confidence.
 */
function mapOCRv5ToBoxes(data: PaddleOCRResponse): PaddleOCRBox[] {
  const results: PaddleOCRBox[] = [];

  const ocrResults = data.result?.ocrResults ?? [];
  for (const page of ocrResults) {
    const pruned = page.prunedResult;
    if (!pruned) continue;

    const { rec_texts, rec_scores, dt_polys } = pruned;
    const count = Math.min(
      rec_texts?.length ?? 0,
      rec_scores?.length ?? 0,
      dt_polys?.length ?? 0,
    );

    for (let i = 0; i < count; i++) {
      const text = rec_texts[i]?.trim();
      if (!text) continue;

      results.push({
        text,
        confidence: rec_scores[i] ?? 0,
        box: dt_polys[i] ?? [],
      });
    }
  }

  return results;
}
