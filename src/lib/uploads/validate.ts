import { z } from "zod/v4";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
] as const;

const MAX_FILE_SIZE = 52428800; // 50 MB
const MAX_PAGE_COUNT = 200;

export const uploadInitSchema = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().gt(0).lte(MAX_FILE_SIZE),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  pageCount: z.number().int().gte(1).lte(MAX_PAGE_COUNT),
  categoryId: z.string().uuid().nullable(),
});

export const uploadCompleteSchema = z.object({
  objectKey: z.string().regex(
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.(pdf|png|jpg|jpeg|webp)$/,
    "Invalid object key format"
  ),
  filename: z.string().min(1).max(255),
  pageCount: z.number().int().gte(1).lte(MAX_PAGE_COUNT),
  categoryId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
});

export interface UploadInitRequest {
  filename: string;
  fileSize: number;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/tiff";
  pageCount: number;
  categoryId: string | null;
}

export interface UploadCompleteRequest {
  objectKey: string;
  filename: string;
  pageCount: number;
  categoryId: string | null;
  clientId: string | null;
}

export function mapValidationError(error: z.ZodError): { code: string; message: string } {
  const issues = error.issues;
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (path === "fileSize") return { code: "file_too_large", message: "File size exceeds 50MB limit" };
    if (path === "mimeType") return { code: "unsupported_mime_type", message: "File type is not supported" };
    if (path === "pageCount") return { code: "page_count_exceeded", message: "Page count exceeds 200 limit" };
    if (path === "categoryId") return { code: "invalid_category", message: "Invalid category" };
    if (path === "objectKey") return { code: "invalid_object_key", message: "Invalid object key format" };
  }
  return { code: "validation_error", message: issues[0]?.message ?? "Validation failed" };
}

export { MAX_FILE_SIZE, MAX_PAGE_COUNT, ALLOWED_MIME_TYPES };
