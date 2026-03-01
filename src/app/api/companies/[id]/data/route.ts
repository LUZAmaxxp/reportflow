import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { auditLog } from "@/lib/db/schema/notifications";
import { companyDeletionQueue } from "@/lib/queues";

/**
 * DELETE /api/companies/{id}/data - Admin-only company data deletion trigger.
 * Validates tenant match and body confirm=true, writes final audit entry,
 * starts asynchronous deletion workflow, returns 202 accepted.
 */
export async function DELETE(
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

  const { company_id, user_id } = session.user;
  const { id } = await params;

  // Tenant match validation
  if (id !== company_id) {
    return NextResponse.json(
      { code: "forbidden", message: "Cannot delete data for another company" },
      { status: 403 }
    );
  }

  let body: { confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { code: "confirmation_required", message: "confirm must be true" },
      { status: 422 }
    );
  }

  try {
    // Write final audit entry before deletion workflow
    await withTenant(db, company_id, async (tx) => {
      await tx.insert(auditLog).values({
        companyId: company_id,
        entityType: "company",
        entityId: company_id,
        action: "company_data_deletion_triggered",
        actorId: user_id,
        metadata: { triggered_at: new Date().toISOString() },
      });
    });

    // Enqueue company-deletion-job
    await companyDeletionQueue.add(
      "company_data_deletion",
      {
        company_id,
        triggered_by: user_id,
      },
      {
        jobId: `company-deletion-${company_id}-${Date.now()}`,
      }
    );

    return NextResponse.json({ status: "accepted" }, { status: 202 });
  } catch (err) {
    console.error("[DELETE /api/companies/[id]/data] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
