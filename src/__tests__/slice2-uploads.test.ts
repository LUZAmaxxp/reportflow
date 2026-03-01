import { describe, it, expect } from "vitest";
import {
  uploadInitSchema,
  uploadCompleteSchema,
  mapValidationError,
  MAX_FILE_SIZE,
  MAX_PAGE_COUNT,
  ALLOWED_MIME_TYPES,
} from "@/lib/uploads/validate";

describe("Upload validation schemas", () => {
  describe("uploadInitSchema", () => {
    const validPayload = {
      filename: "report.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      pageCount: 10,
      categoryId: null,
    };

    it("accepts valid upload init payload", () => {
      const result = uploadInitSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("accepts all allowed MIME types", () => {
      for (const mime of ALLOWED_MIME_TYPES) {
        const result = uploadInitSchema.safeParse({ ...validPayload, mimeType: mime });
        expect(result.success).toBe(true);
      }
    });

    it("accepts categoryId as valid UUID", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        categoryId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
      expect(result.success).toBe(true);
    });

    it("rejects fileSize exceeding 50MB", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        fileSize: MAX_FILE_SIZE + 1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts fileSize exactly at 50MB limit", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        fileSize: MAX_FILE_SIZE,
      });
      expect(result.success).toBe(true);
    });

    it("rejects fileSize of 0", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        fileSize: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative fileSize", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        fileSize: -100,
      });
      expect(result.success).toBe(false);
    });

    it("rejects unsupported MIME type", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        mimeType: "application/zip",
      });
      expect(result.success).toBe(false);
    });

    it("rejects pageCount exceeding 200", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        pageCount: MAX_PAGE_COUNT + 1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects pageCount of 0", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        pageCount: 0,
      });
      expect(result.success).toBe(false);
    });

    it("accepts pageCount at boundary values 1 and 200", () => {
      expect(uploadInitSchema.safeParse({ ...validPayload, pageCount: 1 }).success).toBe(true);
      expect(uploadInitSchema.safeParse({ ...validPayload, pageCount: 200 }).success).toBe(true);
    });

    it("rejects empty filename", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        filename: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects filename exceeding 255 characters", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        filename: "x".repeat(256),
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer fileSize", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        fileSize: 1024.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid categoryId format", () => {
      const result = uploadInitSchema.safeParse({
        ...validPayload,
        categoryId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("uploadCompleteSchema", () => {
    const validPayload = {
      objectKey: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b1ffcc88-8d1a-3df7-aa5c-5aa8ac270b00/original.pdf",
      filename: "report.pdf",
      pageCount: 10,
      categoryId: null,
      clientId: null,
    };

    it("accepts valid upload complete payload", () => {
      const result = uploadCompleteSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("accepts objectKey with various extensions", () => {
      for (const ext of ["pdf", "png", "jpg", "jpeg", "webp"]) {
        const key = `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b1ffcc88-8d1a-3df7-aa5c-5aa8ac270b00/original.${ext}`;
        const result = uploadCompleteSchema.safeParse({ ...validPayload, objectKey: key });
        expect(result.success).toBe(true);
      }
    });

    it("rejects objectKey with wrong pattern", () => {
      const badKeys = [
        "invalid-key",
        "a0eebc99/original.pdf",
        "../../../etc/passwd",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b1ffcc88-8d1a-3df7-aa5c-5aa8ac270b00/original.exe",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b1ffcc88-8d1a-3df7-aa5c-5aa8ac270b00/malicious.pdf",
      ];
      for (const key of badKeys) {
        const result = uploadCompleteSchema.safeParse({ ...validPayload, objectKey: key });
        expect(result.success).toBe(false);
      }
    });

    it("accepts clientId as UUID", () => {
      const result = uploadCompleteSchema.safeParse({
        ...validPayload,
        clientId: "c2ffdd77-7e2b-2ce6-9944-4997bc160c22",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("mapValidationError", () => {
    it("maps fileSize error to file_too_large code", () => {
      const result = uploadInitSchema.safeParse({ filename: "x.pdf", fileSize: 999999999, mimeType: "application/pdf", pageCount: 1, categoryId: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapValidationError(result.error);
        expect(mapped.code).toBe("file_too_large");
      }
    });

    it("maps mimeType error to unsupported_mime_type code", () => {
      const result = uploadInitSchema.safeParse({ filename: "x.pdf", fileSize: 1024, mimeType: "application/zip", pageCount: 1, categoryId: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapValidationError(result.error);
        expect(mapped.code).toBe("unsupported_mime_type");
      }
    });

    it("maps pageCount error to page_count_exceeded code", () => {
      const result = uploadInitSchema.safeParse({ filename: "x.pdf", fileSize: 1024, mimeType: "application/pdf", pageCount: 999, categoryId: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapValidationError(result.error);
        expect(mapped.code).toBe("page_count_exceeded");
      }
    });

    it("maps objectKey error to invalid_object_key code", () => {
      const result = uploadCompleteSchema.safeParse({ objectKey: "bad", filename: "x.pdf", pageCount: 1, categoryId: null, clientId: null });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mapped = mapValidationError(result.error);
        expect(mapped.code).toBe("invalid_object_key");
      }
    });
  });
});

describe("Upload constants", () => {
  it("MAX_FILE_SIZE is 50MB in bytes", () => {
    expect(MAX_FILE_SIZE).toBe(52428800);
  });

  it("MAX_PAGE_COUNT is 200", () => {
    expect(MAX_PAGE_COUNT).toBe(200);
  });

  it("ALLOWED_MIME_TYPES includes PDF and image types", () => {
    expect(ALLOWED_MIME_TYPES).toContain("application/pdf");
    expect(ALLOWED_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_MIME_TYPES).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPES).toContain("image/webp");
    expect(ALLOWED_MIME_TYPES).toContain("image/tiff");
    expect(ALLOWED_MIME_TYPES).toHaveLength(5);
  });
});
