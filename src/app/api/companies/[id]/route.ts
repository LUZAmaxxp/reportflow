import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { companies } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/companies/{id} - Admin-only company name update.
 * Validates path company id equals session company_id and name length 1..100.
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

  // Path id must equal session company_id
  if (id !== company_id) {
    return NextResponse.json(
      { code: "forbidden", message: "Cannot modify another company" },
      { status: 403 }
    );
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { name } = body;

  if (!name || typeof name !== "string" || name.length < 1 || name.length > 100) {
    return NextResponse.json(
      { code: "validation_error", message: "name must be 1-100 characters" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [updated] = await tx
        .update(companies)
        .set({
          name,
          updatedAt: new Date(),
        })
        .where(eq(companies.companyId, company_id))
        .returning({
          company_id: companies.companyId,
          name: companies.name,
          updated_at: companies.updatedAt,
        });

      return {
        company_id: updated.company_id,
        name: updated.name,
        updated_at: updated.updated_at?.toISOString(),
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[PATCH /api/companies/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
