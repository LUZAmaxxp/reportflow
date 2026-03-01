import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentCategories, documents } from "@/lib/db/schema/documents";
import { eq, and, sql, isNull } from "drizzle-orm";

const CATEGORY_MAX_DEPTH = 5;

/**
 * PATCH /api/categories/{id}
 * Supports { name?, parent_category_id? }, recomputes path for self + descendants
 * in one transaction, enforces depth<=5 and path length<=500.
 *
 * DELETE /api/categories/{id}
 * Authenticated and role-limited (admin/editor), returns 409 has_children
 * or 409 has_documents guards, otherwise 204.
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

  // At least one mutable field must be present
  if (name === undefined && !("parent_category_id" in body)) {
    return NextResponse.json(
      { code: "validation_error", message: "At least one of name or parent_category_id must be present" },
      { status: 422 }
    );
  }

  if (name !== undefined && (typeof name !== "string" || name.length === 0 || name.length > 100)) {
    return NextResponse.json(
      { code: "validation_error", message: "name must be 1-100 characters" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Fetch current category
      const [current] = await tx
        .select()
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, id),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);

      if (!current) {
        return { error: "not_found", message: "Category not found", status: 404 };
      }

      const newName = name ?? current.name;
      let newParentCategoryId = current.parentCategoryId;
      let newPath = current.path;
      let newSortOrder = current.sortOrder;

      // Handle parent change (move)
      if ("parent_category_id" in body) {
        newParentCategoryId = parent_category_id ?? null;

        if (newParentCategoryId) {
          // Validate parent exists and compute depth
          const [parent] = await tx
            .select({
              categoryId: documentCategories.categoryId,
              path: documentCategories.path,
            })
            .from(documentCategories)
            .where(
              and(
                eq(documentCategories.categoryId, newParentCategoryId),
                eq(documentCategories.companyId, company_id)
              )
            )
            .limit(1);

          if (!parent) {
            return { error: "validation_error", message: "Parent category not found", status: 422 };
          }

          // Count descendants' max depth to ensure total stays <= CATEGORY_MAX_DEPTH
          const descendants = await tx
            .select({ path: documentCategories.path })
            .from(documentCategories)
            .where(
              and(
                eq(documentCategories.companyId, company_id),
                sql`${documentCategories.path} LIKE ${current.path + '/%'}`
              )
            );

          let maxDescendantDepth = 0;
          for (const d of descendants) {
            const relativeDepth = d.path.split("/").length - current.path.split("/").length;
            if (relativeDepth > maxDescendantDepth) {
              maxDescendantDepth = relativeDepth;
            }
          }

          const parentDepth = parent.path.split("/").filter(Boolean).length;
          const totalDepth = parentDepth + 1 + maxDescendantDepth;

          if (totalDepth > CATEGORY_MAX_DEPTH) {
            return { error: "max_depth_exceeded", message: "Move exceeds maximum depth of 5", status: 422 };
          }

          newPath = `${parent.path}/${newName}`;

          // On parent change (move), set sort_order = MAX+1 among new parent's siblings
          const [maxRow] = await tx
            .select({ maxOrder: sql<number>`coalesce(max(${documentCategories.sortOrder}), -1)` })
            .from(documentCategories)
            .where(
              and(
                eq(documentCategories.parentCategoryId, newParentCategoryId),
                eq(documentCategories.companyId, company_id)
              )
            );
          newSortOrder = (maxRow?.maxOrder ?? -1) + 1;
        } else {
          // Moving to root
          const descendants = await tx
            .select({ path: documentCategories.path })
            .from(documentCategories)
            .where(
              and(
                eq(documentCategories.companyId, company_id),
                sql`${documentCategories.path} LIKE ${current.path + '/%'}`
              )
            );

          let maxDescendantDepth = 0;
          for (const d of descendants) {
            const relativeDepth = d.path.split("/").length - current.path.split("/").length;
            if (relativeDepth > maxDescendantDepth) {
              maxDescendantDepth = relativeDepth;
            }
          }

          if (1 + maxDescendantDepth > CATEGORY_MAX_DEPTH) {
            return { error: "max_depth_exceeded", message: "Move exceeds maximum depth of 5", status: 422 };
          }

          newPath = newName;

          // Sort order among root siblings
          const [maxRow] = await tx
            .select({ maxOrder: sql<number>`coalesce(max(${documentCategories.sortOrder}), -1)` })
            .from(documentCategories)
            .where(
              and(
                isNull(documentCategories.parentCategoryId),
                eq(documentCategories.companyId, company_id)
              )
            );
          newSortOrder = (maxRow?.maxOrder ?? -1) + 1;
        }
      } else if (name !== undefined) {
        // Just a rename — recompute path
        const pathParts = current.path.split("/");
        pathParts[pathParts.length - 1] = newName;
        newPath = pathParts.join("/");
      }

      if (newPath.length > 500) {
        return { error: "path_too_long", message: "Computed path exceeds 500 characters", status: 422 };
      }

      const oldPath = current.path;

      // Update self
      const [updated] = await tx
        .update(documentCategories)
        .set({
          name: newName,
          parentCategoryId: newParentCategoryId,
          path: newPath,
          sortOrder: newSortOrder,
          updatedAt: new Date(),
        })
        .where(eq(documentCategories.categoryId, id))
        .returning({
          category_id: documentCategories.categoryId,
          name: documentCategories.name,
          path: documentCategories.path,
          parent_category_id: documentCategories.parentCategoryId,
          sort_order: documentCategories.sortOrder,
        });

      // Recompute paths for descendants synchronously
      if (oldPath !== newPath) {
        const descendants = await tx
          .select({
            categoryId: documentCategories.categoryId,
            path: documentCategories.path,
          })
          .from(documentCategories)
          .where(
            and(
              eq(documentCategories.companyId, company_id),
              sql`${documentCategories.path} LIKE ${oldPath + '/%'}`
            )
          );

        for (const desc of descendants) {
          const newDescPath = newPath + desc.path.substring(oldPath.length);
          if (newDescPath.length > 500) {
            return { error: "path_too_long", message: "Descendant path exceeds 500 characters", status: 422 };
          }
          await tx
            .update(documentCategories)
            .set({ path: newDescPath, updatedAt: new Date() })
            .where(eq(documentCategories.categoryId, desc.categoryId));
        }
      }

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
    console.error("[PATCH /api/categories/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}

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

  const { role, company_id } = session.user;

  if (role === "viewer") {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Check category exists
      const [cat] = await tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, id),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);

      if (!cat) {
        return { error: "not_found", message: "Category not found", status: 404 };
      }

      // Check for children
      const [childCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.parentCategoryId, id),
            eq(documentCategories.companyId, company_id)
          )
        );

      if ((childCount?.count ?? 0) > 0) {
        return { error: "has_children", message: "Cannot delete category with children", status: 409 };
      }

      // Check for documents assigned to this category
      const [docCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .where(
          and(
            eq(documents.categoryId, id),
            eq(documents.companyId, company_id)
          )
        );

      if ((docCount?.count ?? 0) > 0) {
        return { error: "has_documents", message: "Cannot delete category with assigned documents", status: 409 };
      }

      // Delete
      await tx
        .delete(documentCategories)
        .where(eq(documentCategories.categoryId, id));

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
    console.error("[DELETE /api/categories/[id]] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
