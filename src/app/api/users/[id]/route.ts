import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { users } from "@/lib/db/schema/auth";
import { eq, and, sql } from "drizzle-orm";

const VALID_ROLES = ["admin", "editor", "viewer"] as const;

/**
 * PATCH /api/users/{id} - Admin-only updates role with last_admin guard.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { role } = body;

  if (!role || !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    return NextResponse.json(
      { code: "validation_error", message: "role must be admin, editor, or viewer" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Check target user exists
      const [targetUser] = await tx
        .select({
          userId: users.userId,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.userId, id),
            eq(users.companyId, company_id)
          )
        )
        .limit(1);

      if (!targetUser) {
        return { error: "not_found", message: "User not found", status: 404 };
      }

      // last_admin guard: if demoting an admin, check admin count
      if (targetUser.role === "admin" && role !== "admin") {
        const [adminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.companyId, company_id),
              eq(users.role, "admin")
            )
          );

        if ((adminCount?.count ?? 0) <= 1) {
          return { error: "last_admin", message: "Cannot demote the last admin", status: 422 };
        }
      }

      const [updated] = await tx
        .update(users)
        .set({
          role: role as "admin" | "editor" | "viewer",
          updatedAt: new Date(),
        })
        .where(eq(users.userId, id))
        .returning({
          user_id: users.userId,
          role: users.role,
        });

      return { data: updated };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error("[PATCH /api/users/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/users/{id} - Admin-only enforces last_admin and cannot_delete_self guards.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { company_id, user_id: actorId } = session.user;
  const { id } = await params;

  // cannot_delete_self guard
  if (id === actorId) {
    return NextResponse.json(
      { code: "cannot_delete_self", message: "Cannot delete your own account" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [targetUser] = await tx
        .select({
          userId: users.userId,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.userId, id),
            eq(users.companyId, company_id)
          )
        )
        .limit(1);

      if (!targetUser) {
        return { error: "not_found", message: "User not found", status: 404 };
      }

      // last_admin guard
      if (targetUser.role === "admin") {
        const [adminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.companyId, company_id),
              eq(users.role, "admin")
            )
          );

        if ((adminCount?.count ?? 0) <= 1) {
          return { error: "last_admin", message: "Cannot delete the last admin", status: 422 };
        }
      }

      await tx
        .delete(users)
        .where(eq(users.userId, id));

      return { success: true };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[DELETE /api/users/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
