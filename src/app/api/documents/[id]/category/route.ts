import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentCategories } from "@/lib/db/schema/documents";
import { auditLog } from "@/lib/db/schema/notifications";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

const categoryPatchSchema = z.object({
  categoryId: z.string().uuid().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  if (role === "viewer") {
    return NextResponse.json({ code: "forbidden", message: "Viewers cannot update categories" }, { status: 403 });
  }

  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "validation_error", message: "Invalid JSON" }, { status: 422 });
  }

  const parsed = categoryPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "invalid_category", message: "Invalid category ID" }, { status: 422 });
  }

  const { categoryId } = parsed.data;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify document exists
    const [doc] = await tx
      .select({ documentId: documents.documentId, categoryId: documents.categoryId })
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return { error: "document_not_found" as const };

    // Validate category belongs to tenant when non-null
    if (categoryId) {
      const [category] = await tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, categoryId),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);

      if (!category) {
        return { error: "invalid_category" as const };
      }
    }

    const now = new Date();

    // Update document
    await tx
      .update(documents)
      .set({
        categoryId: categoryId,
        updatedAt: now,
      })
      .where(eq(documents.documentId, id));

    // Insert audit log
    await tx.insert(auditLog).values({
      companyId: company_id,
      entityType: "document",
      entityId: id,
      action: "category_changed",
      actorId: user_id,
      metadata: {
        previousCategoryId: doc.categoryId,
        newCategoryId: categoryId,
      },
    });

    return { documentId: id, categoryId, updatedAt: now.toISOString() };
  });

  if ("error" in result) {
    if (result.error === "document_not_found") {
      return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
    }
    if (result.error === "invalid_category") {
      return NextResponse.json({ code: "invalid_category", message: "Category not found in tenant" }, { status: 422 });
    }
  }

  return NextResponse.json(result);
}
