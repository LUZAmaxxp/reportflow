import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { conflictCases } from "@/lib/db/schema/conflicts";
import { observations } from "@/lib/db/schema/observations";
import { documentVersions } from "@/lib/db/schema/documents";
import { eq, and, sql, desc } from "drizzle-orm";

const VALID_RESOLUTION_STATUSES = ["auto_resolved", "user_reviewed", "user_overridden"] as const;
const VALID_MATCH_METHODS = ["exact", "semantic"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const { company_id } = session.user;
  const url = new URL(req.url);

  // Parse and validate query params
  const resolutionStatus = url.searchParams.get("resolutionStatus");
  const matchMethod = url.searchParams.get("matchMethod");
  const normalizedKey = url.searchParams.get("normalizedKey");
  const pageStr = url.searchParams.get("page") ?? "1";
  const limitStr = url.searchParams.get("limit") ?? "20";

  const page = parseInt(pageStr, 10);
  const limit = parseInt(limitStr, 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ code: "INVALID_QUERY", message: "page and limit must be positive integers (limit max 100)" }, { status: 422 });
  }

  if (resolutionStatus && !(VALID_RESOLUTION_STATUSES as readonly string[]).includes(resolutionStatus)) {
    return NextResponse.json({ code: "INVALID_QUERY", message: "resolutionStatus must be one of auto_resolved|user_reviewed|user_overridden" }, { status: 422 });
  }

  if (matchMethod && !(VALID_MATCH_METHODS as readonly string[]).includes(matchMethod)) {
    return NextResponse.json({ code: "INVALID_QUERY", message: "matchMethod must be exact|semantic" }, { status: 422 });
  }

  const offset = (page - 1) * limit;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Build conditions
      const conditions: any[] = [eq(conflictCases.companyId, company_id)];

      if (resolutionStatus) {
        conditions.push(eq(conflictCases.resolutionStatus, resolutionStatus as any));
      }
      if (matchMethod) {
        conditions.push(eq(conflictCases.matchMethod, matchMethod as any));
      }
      if (normalizedKey) {
        conditions.push(eq(conflictCases.normalizedKey, normalizedKey));
      }

      const whereClause = and(...conditions);

      // Count total
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(conflictCases)
        .where(whereClause);

      const total = countRow?.count ?? 0;

      // Fetch conflict cases
      const cases = await tx
        .select()
        .from(conflictCases)
        .where(whereClause)
        .orderBy(desc(conflictCases.createdAt))
        .limit(limit)
        .offset(offset);

      // Build response data with winning/losing observation projections
      const data = await Promise.all(
        cases.map(async (cc: any) => {
          let winningObservation = null;
          const losingObservations: any[] = [];

          for (const obsId of cc.observationIds) {
            const [obs] = await tx
              .select({
                id: observations.observationId,
                label: observations.label,
                value: observations.value,
                unit: observations.unit,
                sourceDocumentVersionId: observations.sourceDocumentVersionId,
              })
              .from(observations)
              .where(eq(observations.observationId, obsId))
              .limit(1);

            if (!obs) continue;

            // Fetch source document filename and uploadedAt if available
            let sourceDocumentFilename: string | null = null;
            let uploadedAt: string | null = null;
            if (obs.sourceDocumentVersionId) {
              const [dv] = await tx
                .select({
                  originalFilename: documentVersions.originalFilename,
                  createdAt: documentVersions.createdAt,
                })
                .from(documentVersions)
                .where(eq(documentVersions.documentVersionId, obs.sourceDocumentVersionId))
                .limit(1);
              if (dv) {
                sourceDocumentFilename = dv.originalFilename;
                uploadedAt = dv.createdAt?.toISOString() ?? null;
              }
            }

            const obsProjection = {
              id: obs.id,
              label: obs.label,
              value: obs.value,
              unit: obs.unit,
              sourceDocumentFilename,
              uploadedAt,
            };

            if (obsId === cc.winningObservationId) {
              winningObservation = obsProjection;
            } else {
              losingObservations.push(obsProjection);
            }
          }

          return {
            id: cc.conflictId,
            normalizedKey: cc.normalizedKey,
            conflictGroupId: cc.conflictGroupId,
            matchMethod: cc.matchMethod,
            periodStart: cc.periodStart,
            periodEnd: cc.periodEnd,
            resolutionStatus: cc.resolutionStatus,
            autoResolved: cc.autoResolved,
            winningObservation,
            losingObservations,
            createdAt: cc.createdAt?.toISOString(),
          };
        })
      );

      return { data, total };
    });

    return NextResponse.json({
      data: result.data,
      total: result.total,
      page,
      pageSize: limit,
    });
  } catch (err) {
    console.error("[GET /api/conflicts] Error:", err);
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Internal server error" }, { status: 500 });
  }
}
