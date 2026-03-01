import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateUploadUrl } from "@/lib/uploads/presign";

// Mock S3 and R2 dependencies
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://r2.example.com/signed-url?X-Amz-Signature=abc"),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockPutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    PutObjectCommand: MockPutObjectCommand,
    S3Client: class {},
  };
});

vi.mock("@/lib/r2", () => ({
  r2Client: {},
  R2_BUCKET: "test-bucket",
}));

describe("Presigned URL generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates URL with correct objectKey pattern", async () => {
    const result = await generateUploadUrl("company-123", "pdf", "application/pdf", 1024);

    expect(result.objectKey).toMatch(/^company-123\/[0-9a-f-]+\/original\.pdf$/);
    expect(result.uploadUrl).toContain("https://");
    expect(result.expiresIn).toBe(900);
  });

  it("includes file extension in object key", async () => {
    const pdfResult = await generateUploadUrl("c1", "pdf", "application/pdf", 1024);
    expect(pdfResult.objectKey).toMatch(/\.pdf$/);

    const pngResult = await generateUploadUrl("c1", "png", "image/png", 1024);
    expect(pngResult.objectKey).toMatch(/\.png$/);
  });

  it("generates unique object keys per call", async () => {
    const r1 = await generateUploadUrl("c1", "pdf", "application/pdf", 1024);
    const r2 = await generateUploadUrl("c1", "pdf", "application/pdf", 1024);
    expect(r1.objectKey).not.toBe(r2.objectKey);
  });

  it("uses company ID as prefix for tenant isolation", async () => {
    const result = await generateUploadUrl("tenant-abc", "pdf", "application/pdf", 1024);
    expect(result.objectKey.startsWith("tenant-abc/")).toBe(true);
  });

  it("always returns expiresIn of 900 seconds", async () => {
    const result = await generateUploadUrl("c1", "jpg", "image/jpeg", 5000);
    expect(result.expiresIn).toBe(900);
  });
});
