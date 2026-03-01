import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";

/**
 * PATCH /api/categories/reorder
 * RISK-05 atomic sibling reorder validation.
 * Body: { ordered_ids: UUID[], parent_category_id: UUID|null }
 * parent_category_id key is required even when null.
 * All ordered_ids must share exact requested parent; mixed parents => 422 { code: mixed_parents }.
 * Updates sort_order by array index in one transaction.
 */
export async function PATCH(req: NextRequest) {
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

  let body: { ordered_ids?: string[]; parent_category_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  // Validate parent_category_id key is present
  if (!("parent_category_id" in body)) {
    return NextResponse.json(
      { code: "validation_error", message: "parent_category_id key is required even when null" },
      { status: 422 }
    );
  }

  const parentCategoryId = body.parent_category_id ?? null;
  const orderedIds = body.ordered_ids!;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json(
      { code: "validation_error", message: "ordered_ids must be a non-empty array" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx: any) => {
      // Validate all ordered_ids share same parent_category_id
      const parentCondition = parentCategoryId === null
        ? isNull(documentCategories.parentCategoryId)
        : eq(documentCategories.parentCategoryId, parentCategoryId);

      const matching = await tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            inArray(documentCategories.categoryId, orderedIds),
            eq(documentCategories.companyId, company_id),
            parentCondition
          )
        );

      if (matching.length !== orderedIds.length) {
        return { error: "mixed_parents", message: "All ordered_ids must share the same parent_category_id", status: 422 };
      }

      // Update sort_order by array index
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(documentCategories)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(documentCategories.categoryId, orderedIds[i]),
              eq(documentCategories.companyId, company_id)
            )
          );
      }

      return { updated_count: orderedIds.length };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[PATCH /api/categories/reorder] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
