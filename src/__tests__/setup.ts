import { beforeAll } from "vitest";

// Load test environment variables
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/reportflow_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
  process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "test-account";
  process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "test-key-id";
  process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "test-secret-key";
  process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "test-bucket";
  process.env.XAI_API_KEY = process.env.XAI_API_KEY ?? "xai-test";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "sk-proj-test";
  process.env.PADDLEOCR_TOKEN = process.env.PADDLEOCR_TOKEN ?? "paddle-test";
  process.env.PADDLEOCR_API_URL = process.env.PADDLEOCR_API_URL ?? "https://paddle.test/ocr";
  process.env.MEM0_API_KEY = process.env.MEM0_API_KEY ?? "m0-test";
  process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "y8Qm2d1xR5v1o49eUad8Qm0N7v9w3hH2Qk8w7u4jIaa";
  process.env.AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST ?? "true";
  process.env.PDF_WORKER_URL = process.env.PDF_WORKER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});
