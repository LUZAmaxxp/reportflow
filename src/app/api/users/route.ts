import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { users } from "@/lib/db/schema/auth";
import { eq, and, sql, desc } from "drizzle-orm";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["editor", "viewer"] as const;

/**
 * GET /api/users - Admin-only paginated users { user_id, email, role, created_at }.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { code: "forbidden", message: "Admin access required" },
      { status: 403 }
    );
  }

  const { company_id } = session.user;
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const result = await withTenant(db, company_id, async (tx: any) => {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.companyId, company_id));

      const total = countRow?.count ?? 0;

      const rows = await tx
        .select({
          user_id: users.userId,
          email: users.email,
          role: users.role,
          created_at: users.createdAt,
        })
        .from(users)
        .where(eq(users.companyId, company_id))
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset);

      const data = rows.map((r: any) => ({
        user_id: r.user_id,
        email: r.email,
        role: r.role,
        created_at: r.created_at?.toISOString(),
      }));

      return { data, total, page, pageSize };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/users] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users - Admin-only creates user with email + role.
 * SPEC DEVIATION: MVP intentionally skips email invitation status workflow;
 * POST /api/users creates immediately active users per Slice 6 RISK-10 resolution.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { code: "forbidden", message: "Admin access required" },
      { status: 403 }
    );
  }

  const { company_id } = session.user;

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { email, role } = body;

  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { code: "validation_error", message: "Valid email is required" },
      { status: 422 }
    );
  }

  if (!role || !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    return NextResponse.json(
      { code: "validation_error", message: "role must be editor or viewer" },
      { status: 422 }
    );
  }

  try {
    // Check for existing email across all companies
    const [existingUser] = await db
      .select({
        userId: users.userId,
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingUser) {
      if (existingUser.companyId === company_id) {
        return NextResponse.json(
          { code: "email_already_exists", message: "Email already exists in company" },
          { status: 409 }
        );
      } else {
        return NextResponse.json(
          { code: "email_belongs_to_other_company", message: "Email belongs to another company" },
          { status: 409 }
        );
      }
    }

    const result = await withTenant(db, company_id, async (tx: any) => {
      // Create user with a placeholder password hash (no invitation lifecycle in MVP)
      const bcrypt = await import("bcryptjs");
      const placeholderHash = await bcrypt.hash("changeme-" + Date.now(), 10);

      const [created] = await tx
        .insert(users)
        .values({
          companyId: company_id,
          email: email.toLowerCase(),
          passwordHash: placeholderHash,
          role: role as "editor" | "viewer",
        })
        .returning({
          user_id: users.userId,
          email: users.email,
          role: users.role,
          created_at: users.createdAt,
        });

      return {
        user_id: created.user_id,
        email: created.email,
        role: created.role,
        created_at: created.created_at?.toISOString(),
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[POST /api/users] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
