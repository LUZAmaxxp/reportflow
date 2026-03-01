import { z } from "zod/v4";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  XAI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  PADDLEOCR_TOKEN: z.string().min(1),
  PADDLEOCR_API_URL: z.url(),
  MEM0_API_KEY: z.string().min(1),
  NEXTAUTH_URL: z.url(),
  NEXTAUTH_SECRET: z.string().min(32),
  AUTH_TRUST_HOST: z.coerce.boolean(),
  PDF_WORKER_URL: z.url(),
  NEXT_PUBLIC_APP_URL: z.url(),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
  PUPPETEER_SKIP_DOWNLOAD: z.coerce.boolean().optional(),
});

let _env: z.infer<typeof envSchema> | undefined;

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getEnv() {
  if (_env) return _env;
  if (isBuildPhase()) {
    // Return stub during build — validated at runtime
    return {} as z.infer<typeof envSchema>;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues
      .map((i) => i.path.join("."))
      .filter(Boolean);
    throw new Error(
      `Invalid environment configuration. Missing/invalid keys: ${keys.join(", ")}`
    );
  }
  _env = parsed.data;
  return _env;
}

export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof z.infer<typeof envSchema>];
  },
});
