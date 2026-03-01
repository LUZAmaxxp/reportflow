// MCP tool: get_categories — Slice 5
// Return nested category tree scoped to ctx.companyId.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, asc } from "drizzle-orm";
import type { AgentContext } from "@/lib/mcp/index";

interface CategoryNode {
  category_id: string;
  name: string;
  path: string;
  parent_category_id: string | null;
  children: CategoryNode[];
}

export async function getCategories(
  _input: Record<string, never>,
  ctx: AgentContext
): Promise<{ categories: CategoryNode[] }> {
  const result = await withTenant(db, ctx.companyId, async (tx) => {
    const rows = await tx
      .select({
        category_id: documentCategories.categoryId,
        name: documentCategories.name,
        path: documentCategories.path,
        parent_category_id: documentCategories.parentCategoryId,
      })
      .from(documentCategories)
      .where(eq(documentCategories.companyId, ctx.companyId))
      .orderBy(asc(documentCategories.path), asc(documentCategories.sortOrder));

    // Build tree
    const nodeMap = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const row of rows) {
      const node: CategoryNode = {
        category_id: row.category_id,
        name: row.name,
        path: row.path,
        parent_category_id: row.parent_category_id,
        children: [],
      };
      nodeMap.set(row.category_id, node);
    }

    for (const node of nodeMap.values()) {
      if (node.parent_category_id && nodeMap.has(node.parent_category_id)) {
        nodeMap.get(node.parent_category_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  });

  return { categories: result };
}
