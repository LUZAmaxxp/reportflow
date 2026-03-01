import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

const SCOPE_PATTERN = /^user:([0-9a-f-]{36}):company:([0-9a-f-]{36})(?::client:([0-9a-f-]{36}))?$/i;

/**
 * GET /api/preferences
 * RISK-06 preference scope semantics.
 * Accepts optional scope and defaults to user:{ctx.userId}:company:{ctx.companyId}.
 * On mem0 timeout returns 200 { preferences: {} }.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { user_id, company_id } = session.user;
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");

  let scope = `user:${user_id}:company:${company_id}`;

  if (scopeParam) {
    const match = SCOPE_PATTERN.exec(scopeParam);
    if (!match) {
      return NextResponse.json(
        { code: "invalid_scope", message: "Malformed scope format" },
        { status: 422 }
      );
    }
    // Validate scope user matches session user
    if (match[1] !== user_id) {
      return NextResponse.json(
        { code: "invalid_scope", message: "Scope user does not match session user" },
        { status: 422 }
      );
    }
    scope = scopeParam;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch("https://api.mem0.ai/v1/memories/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${env.MEM0_API_KEY}`,
      },
      body: JSON.stringify({
        query: "style preferences report formatting",
        user_id: scope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json({ scope, preferences: {} });
    }

    const data = await response.json();
    const preferences: Record<string, unknown> = {};

    if (Array.isArray(data.results)) {
      for (const mem of data.results) {
        if (mem.metadata && typeof mem.metadata === "object") {
          Object.assign(preferences, mem.metadata);
        }
      }
    }

    return NextResponse.json({ scope, preferences });
  } catch {
    // On mem0 timeout return 200 with empty preferences
    return NextResponse.json({ scope, preferences: {} });
  }
}

/**
 * DELETE /api/preferences
 * Accepts optional scope; without scope deletes all user+company scopes.
 * Validates scope pattern. mem0 timeout returns 503 { code: mem0_unavailable }.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { user_id, company_id } = session.user;
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get("scope");

  const scopes: string[] = [];

  if (scopeParam) {
    const match = SCOPE_PATTERN.exec(scopeParam);
    if (!match) {
      return NextResponse.json(
        { code: "invalid_scope", message: "Malformed scope format" },
        { status: 422 }
      );
    }
    if (match[1] !== user_id) {
      return NextResponse.json(
        { code: "invalid_scope", message: "Scope user does not match session user" },
        { status: 422 }
      );
    }
    scopes.push(scopeParam);
  } else {
    // Without scope: delete all user+company scopes
    scopes.push(`user:${user_id}:company:${company_id}`);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    for (const scope of scopes) {
      const response = await fetch("https://api.mem0.ai/v1/memories/", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${env.MEM0_API_KEY}`,
        },
        body: JSON.stringify({ user_id: scope }),
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404) {
        clearTimeout(timeoutId);
        return NextResponse.json(
          { code: "mem0_unavailable", message: "mem0 delete failed" },
          { status: 503 }
        );
      }
    }

    clearTimeout(timeoutId);
    return new NextResponse(null, { status: 204 });
  } catch {
    // mem0 timeout returns 503
    return NextResponse.json(
      { code: "mem0_unavailable", message: "mem0 service unavailable" },
      { status: 503 }
    );
  }
}
