import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { clients } from "@/lib/db/schema/documents";
import { reports } from "@/lib/db/schema/reports";
import { eq, and, sql } from "drizzle-orm";

/**
 * GET /api/clients/{id} - Returns single client or 404 via tenant scope.
 */
export async function GET(
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

  const { company_id } = session.user;
  const { id } = await params;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [client] = await tx
        .select({
          client_id: clients.clientId,
          company_id: clients.companyId,
          name: clients.name,
          created_at: clients.createdAt,
          updated_at: clients.updatedAt,
        })
        .from(clients)
        .where(
          and(
            eq(clients.clientId, id),
            eq(clients.companyId, company_id)
          )
        )
        .limit(1);

      if (!client) {
        return { error: "not_found", message: "Client not found", status: 404 };
      }

      return {
        data: {
          client_id: client.client_id,
          company_id: client.company_id,
          name: client.name,
          description: null as string | null,
          created_at: client.created_at?.toISOString(),
          updated_at: client.updated_at?.toISOString(),
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error("[GET /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/clients/{id} - Editor/admin updates fields.
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

  const { role, company_id } = session.user;

  if (role === "viewer") {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const { id } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  if (body.name === undefined && body.description === undefined) {
    return NextResponse.json(
      { code: "validation_error", message: "At least one field must be provided" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [existing] = await tx
        .select({ clientId: clients.clientId })
        .from(clients)
        .where(
          and(
            eq(clients.clientId, id),
            eq(clients.companyId, company_id)
          )
        )
        .limit(1);

      if (!existing) {
        return { error: "not_found", message: "Client not found", status: 404 };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;

      const [updated] = await tx
        .update(clients)
        .set(updates)
        .where(eq(clients.clientId, id))
        .returning({
          client_id: clients.clientId,
          name: clients.name,
          updated_at: clients.updatedAt,
        });

      return {
        data: {
          client_id: updated.client_id,
          name: updated.name,
          description: body.description ?? null,
          updated_at: updated.updated_at?.toISOString(),
        },
      };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error("[PATCH /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/{id} - Admin-only blocks with 409 has_reports when referenced.
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

  const { company_id } = session.user;
  const { id } = await params;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [existing] = await tx
        .select({ clientId: clients.clientId })
        .from(clients)
        .where(
          and(
            eq(clients.clientId, id),
            eq(clients.companyId, company_id)
          )
        )
        .limit(1);

      if (!existing) {
        return { error: "not_found", message: "Client not found", status: 404 };
      }

      // Check for reports referencing this client
      const [reportCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(reports)
        .where(
          and(
            eq(reports.clientId, id),
            eq(reports.companyId, company_id)
          )
        );

      if ((reportCount?.count ?? 0) > 0) {
        return { error: "has_reports", message: "Cannot delete client referenced by reports", status: 409 };
      }

      await tx
        .delete(clients)
        .where(eq(clients.clientId, id));

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
    console.error("[DELETE /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
