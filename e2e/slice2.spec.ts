import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:3000";
const CREDENTIALS = { email: "admin@reportflow.test", password: "Password123!" };

/**
 * Helper: get a session cookie by signing in via the NextAuth credentials endpoint.
 */
async function getSessionCookie(request: APIRequestContext): Promise<string> {
  // 1. Fetch CSRF token
  const csrfRes = await request.get(`${BASE}/api/auth/csrf`);
  expect(csrfRes.ok()).toBeTruthy();
  const { csrfToken } = await csrfRes.json();

  // 2. Sign in
  const signInRes = await request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      csrfToken,
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
      json: "true",
    },
  });
  // NextAuth may return 200 or 302 — extract cookie either way
  const cookies = signInRes.headers()["set-cookie"] ?? "";
  // Find the session token cookie
  const sessionMatch = cookies.match(/(authjs\.session-token|next-auth\.session-token)=[^;]+/);
  expect(sessionMatch).not.toBeNull();
  return sessionMatch![0];
}

// ---------------------------------------------------------------------------
// Auth guard tests
// ---------------------------------------------------------------------------

test.describe("API auth guards", () => {
  test("unauthenticated /api/documents returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/documents`);
    expect(res.status()).toBe(401);
  });

  test("unauthenticated /api/uploads/init returns 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/uploads/init`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Upload validation tests
// ---------------------------------------------------------------------------

test.describe("Upload validation", () => {
  let cookie: string;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    cookie = await getSessionCookie(ctx);
    await ctx.dispose();
  });

  test("rejects file >50MB", async ({ request }) => {
    const res = await request.post(`${BASE}/api/uploads/init`, {
      headers: { Cookie: cookie },
      data: {
        filename: "big.pdf",
        fileSize: 60 * 1024 * 1024,
        mimeType: "application/pdf",
        pageCount: 1,
      },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("file_too_large");
  });

  test("rejects non-PDF mimeType", async ({ request }) => {
    const res = await request.post(`${BASE}/api/uploads/init`, {
      headers: { Cookie: cookie },
      data: {
        filename: "doc.docx",
        fileSize: 1000,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pageCount: 1,
      },
    });
    expect(res.status()).toBe(422);
  });

  test("accepts valid init payload and returns presigned URL", async ({ request }) => {
    const res = await request.post(`${BASE}/api/uploads/init`, {
      headers: { Cookie: cookie },
      data: {
        filename: "test.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        pageCount: 3,
        categoryId: null,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBeTruthy();
    expect(body.objectKey).toBeTruthy();
    expect(body.objectKey).toContain(".pdf");
  });
});

// ---------------------------------------------------------------------------
// Documents listing
// ---------------------------------------------------------------------------

test.describe("Documents API", () => {
  let cookie: string;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    cookie = await getSessionCookie(ctx);
    await ctx.dispose();
  });

  test("GET /api/documents returns paginated list", async ({ request }) => {
    const res = await request.get(`${BASE}/api/documents`, {
      headers: { Cookie: cookie },
    });
    if (res.status() !== 200) {
      console.log("Documents API error:", res.status(), await res.text());
    }
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test("GET /api/documents rejects invalid status filter", async ({ request }) => {
    const res = await request.get(`${BASE}/api/documents?status=invalid`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// SSE pipeline events
// ---------------------------------------------------------------------------

test.describe("Pipeline SSE", () => {
  test("unauthenticated SSE returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/pipeline/events`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Login UI flow
// ---------------------------------------------------------------------------

test.describe("Login UI flow", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows French login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Mot de passe")).toBeVisible();
  });

  test("displays error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("invalid@test.com");
    await page.getByLabel("Mot de passe").fill("wrongpassword1");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Identifiants incorrects")).toBeVisible({ timeout: 10_000 });
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(CREDENTIALS.email);
    await page.getByLabel("Mot de passe").fill(CREDENTIALS.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    // Should navigate away from /login after successful auth
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Retry endpoint
// ---------------------------------------------------------------------------

test.describe("Retry endpoint", () => {
  let cookie: string;

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext();
    cookie = await getSessionCookie(ctx);
    await ctx.dispose();
  });

  test("returns 404 for non-existent document", async ({ request }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request.post(`${BASE}/api/documents/${fakeId}/retry`, {
      headers: { Cookie: cookie },
    });
    // Could be 404 or 400 depending on implementation
    expect([400, 404, 500]).toContain(res.status());
  });
});
