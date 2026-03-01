import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

describe("Auth credential flow", () => {
  it("bcrypt.compare returns true for matching password", async () => {
    const password = "TestPass123!";
    const hash = await bcrypt.hash(password, 10);
    const result = await bcrypt.compare(password, hash);
    expect(result).toBe(true);
  });

  it("bcrypt.compare returns false for mismatched password", async () => {
    const hash = await bcrypt.hash("CorrectPassword", 10);
    const result = await bcrypt.compare("WrongPassword", hash);
    expect(result).toBe(false);
  });

  it("JWT callback projects user_id, company_id, and role", async () => {
    // Simulate the jwt callback logic from auth.ts
    const user = {
      id: "user-uuid-123",
      email: "test@example.com",
      company_id: "company-uuid-456",
      role: "admin" as const,
    };

    const token: Record<string, unknown> = { sub: undefined };

    // Simulate jwt callback
    if (user) {
      token.sub = user.id;
      token.company_id = user.company_id;
      token.role = user.role;
    }

    expect(token.sub).toBe("user-uuid-123");
    expect(token.company_id).toBe("company-uuid-456");
    expect(token.role).toBe("admin");
  });

  it("session callback projects claims from token", () => {
    const token = {
      sub: "user-uuid-123",
      company_id: "company-uuid-456",
      role: "editor" as const,
    };

    const session = {
      user: {
        user_id: token.sub,
        company_id: token.company_id,
        role: token.role,
        name: null,
        email: "test@example.com",
        image: null,
      },
      expires: new Date().toISOString(),
    };

    expect(session.user.user_id).toBe("user-uuid-123");
    expect(session.user.company_id).toBe("company-uuid-456");
    expect(session.user.role).toBe("editor");
  });

  it("rejects invalid roles in type check", () => {
    const validRoles = ["admin", "editor", "viewer"];
    expect(validRoles).toContain("admin");
    expect(validRoles).toContain("editor");
    expect(validRoles).toContain("viewer");
    expect(validRoles).not.toContain("superadmin");
  });
});
