import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { clients } from "@/lib/db/schema/documents";
import { eq, and, sql, desc, ilike } from "drizzle-orm";

/**
 * GET /api/clients - MR-03 client list with case-insensitive name search and pagination.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { company_id } = session.user;
  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const result = await withTenant(db, company_id, async (tx: any) => {
      const conditions = [eq(clients.companyId, company_id)];
      if (search) {
        conditions.push(ilike(clients.name, `%${search}%`));
      }

      const whereClause = and(...conditions);

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(clients)
        .where(whereClause);

      const total = countRow?.count ?? 0;

      const rows = await tx
        .select({
          client_id: clients.clientId,
          company_id: clients.companyId,
          name: clients.name,
          created_at: clients.createdAt,
          updated_at: clients.updatedAt,
        })
        .from(clients)
        .where(whereClause)
        .orderBy(desc(clients.createdAt))
        .limit(pageSize)
        .offset(offset);

      const data = rows.map((r: any) => ({
        client_id: r.client_id,
        company_id: r.company_id,
        name: r.name,
        description: null as string | null,
        created_at: r.created_at?.toISOString(),
        updated_at: r.updated_at?.toISOString(),
      }));

      return { data, total, page, pageSize };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/clients] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients - MR-03 editor/admin creates client.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { role, company_id, user_id } = session.user;

  if (role === "viewer") {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient permissions" },
      { status: 403 }
    );
  }

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { name, description } = body;

  if (!name || typeof name !== "string" || name.length < 1 || name.length > 200) {
    return NextResponse.json(
      { code: "validation_error", message: "name is required and must be 1-200 characters" },
      { status: 422 }
    );
  }

  if (description !== undefined && (typeof description !== "string" || description.length > 1000)) {
    return NextResponse.json(
      { code: "validation_error", message: "description must be max 1000 characters" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx: any) => {
      const [created] = await tx
        .insert(clients)
        .values({
          companyId: company_id,
          name,
          createdBy: user_id,
        })
        .returning({
          client_id: clients.clientId,
          company_id: clients.companyId,
          name: clients.name,
          created_at: clients.createdAt,
        });

      return {
        client_id: created.client_id,
        company_id: created.company_id,
        name: created.name,
        description: description ?? null,
        created_at: created.created_at?.toISOString(),
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
