import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadInitSchema, mapValidationError } from "@/lib/uploads/validate";
import { generateUploadUrl } from "@/lib/uploads/presign";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  if (role === "viewer") {
    return NextResponse.json({ code: "forbidden", message: "Viewers cannot upload" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "validation_error", message: "Invalid JSON" }, { status: 422 });
  }

  const parsed = uploadInitSchema.safeParse(body);
  if (!parsed.success) {
    const error = mapValidationError(parsed.error);
    return NextResponse.json(error, { status: 422 });
  }

  const { filename, fileSize, mimeType, pageCount, categoryId } = parsed.data;

  // Validate category belongs to tenant
  if (categoryId) {
    const [category] = await withTenant(db, company_id, async (tx) => {
      return tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, categoryId),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);
    });

    if (!category) {
      return NextResponse.json({ code: "invalid_category", message: "Category not found in tenant" }, { status: 422 });
    }
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "pdf";
  const normalizedExt = ext === "jpeg" ? "jpg" : ext;
  const validExtensions = ["pdf", "png", "jpg", "webp"];
  const finalExt = validExtensions.includes(normalizedExt) ? normalizedExt : "pdf";

  const { uploadUrl, objectKey, expiresIn } = await generateUploadUrl(
    company_id,
    finalExt,
    mimeType,
    fileSize
  );

  return NextResponse.json({ uploadUrl, objectKey, expiresIn });
}
