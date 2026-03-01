import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, asc, sql, and, isNull } from "drizzle-orm";
import type { CategoryNode } from "@/types/categories";

const CATEGORY_MAX_DEPTH = 5;

interface FlatCategory {
  category_id: string;
  name: string;
  path: string;
  parent_category_id: string | null;
  sort_order: number;
}

function buildTree(flat: FlatCategory[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  for (const cat of flat) {
    map.set(cat.category_id, {
      category_id: cat.category_id,
      name: cat.name,
      path: cat.path,
      parent_category_id: cat.parent_category_id,
      sort_order: cat.sort_order,
      children: [],
    });
  }

  for (const cat of flat) {
    const node = map.get(cat.category_id)!;
    if (cat.parent_category_id && map.has(cat.parent_category_id)) {
      const parent = map.get(cat.parent_category_id)!;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children at each level by sort_order
  function sortChildren(nodes: CategoryNode[]) {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    for (const n of nodes) {
      if (n.children) sortChildren(n.children);
    }
  }
  sortChildren(roots);

  return roots;
}

/**
 * GET /api/categories - Returns nested { categories: CategoryNode[] } sorted by sort_order asc per sibling.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { company_id } = session.user;

  const result = await withTenant(db, company_id, async (tx) => {
    const rows = await tx
      .select({
        category_id: documentCategories.categoryId,
        name: documentCategories.name,
        path: documentCategories.path,
        parent_category_id: documentCategories.parentCategoryId,
        sort_order: documentCategories.sortOrder,
      })
      .from(documentCategories)
      .where(eq(documentCategories.companyId, company_id))
      .orderBy(asc(documentCategories.sortOrder));

    return rows as FlatCategory[];
  });

  const categories = buildTree(result);

  return NextResponse.json({ categories });
}

/**
 * POST /api/categories - Create a new category.
 * Validates name<=100, optional parent_category_id, enforces max depth 5,
 * computes path synchronously, assigns sort_order = MAX+1 among siblings.
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

  let body: { name?: string; parent_category_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { name, parent_category_id } = body;

  if (!name || typeof name !== "string" || name.length === 0 || name.length > 100) {
    return NextResponse.json(
      { code: "validation_error", message: "name is required and must be 1-100 characters" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      let parentPath = "";
      let depth = 1;

      if (parent_category_id) {
        // Validate parent exists in same company
        const [parent] = await tx
          .select({
            categoryId: documentCategories.categoryId,
            path: documentCategories.path,
          })
          .from(documentCategories)
          .where(
            and(
              eq(documentCategories.categoryId, parent_category_id),
              eq(documentCategories.companyId, company_id)
            )
          )
          .limit(1);

        if (!parent) {
          return { error: "validation_error", message: "Parent category not found", status: 422 };
        }

        parentPath = parent.path;
        // Depth = number of segments in parent path + 1
        depth = parentPath.split("/").filter(Boolean).length + 1;

        if (depth > CATEGORY_MAX_DEPTH) {
          return { error: "max_depth_exceeded", message: "Maximum category depth is 5", status: 422 };
        }
      }

      // Compute sort_order = MAX+1 among siblings
      const siblingCondition = parent_category_id
        ? eq(documentCategories.parentCategoryId, parent_category_id)
        : and(
            isNull(documentCategories.parentCategoryId),
            eq(documentCategories.companyId, company_id)
          );

      const [maxRow] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${documentCategories.sortOrder}), -1)` })
        .from(documentCategories)
        .where(
          and(
            siblingCondition,
            eq(documentCategories.companyId, company_id)
          )
        );

      const sort_order = (maxRow?.maxOrder ?? -1) + 1;

      // Compute path
      const path = parentPath ? `${parentPath}/${name}` : name;

      if (path.length > 500) {
        return { error: "path_too_long", message: "Computed path exceeds 500 characters", status: 422 };
      }

      // Insert
      const [created] = await tx
        .insert(documentCategories)
        .values({
          companyId: company_id,
          name,
          description: null,
          parentCategoryId: parent_category_id ?? null,
          path,
          sortOrder: sort_order,
          createdBy: user_id,
        })
        .returning({
          category_id: documentCategories.categoryId,
          name: documentCategories.name,
          path: documentCategories.path,
          parent_category_id: documentCategories.parentCategoryId,
          sort_order: documentCategories.sortOrder,
        });

      return { data: created };
    });

    if ("error" in result) {
      return NextResponse.json(
        { code: result.error, message: result.message },
        { status: result.status as number }
      );
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (err) {
    console.error("[POST /api/categories] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
