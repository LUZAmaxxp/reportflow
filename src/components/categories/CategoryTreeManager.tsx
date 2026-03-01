"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { fr } from "@/lib/messages/fr";
import type { CategoryNode } from "@/types/categories";
import CategoryNodeComponent from "./CategoryNode";
import CategoryNodeForm from "./CategoryNodeForm";

const CATEGORY_REORDER_DEBOUNCE_MS = 400;

interface CategoryTreeManagerProps {
  initialCategories: CategoryNode[];
}

export default function CategoryTreeManager({ initialCategories }: CategoryTreeManagerProps) {
  const [categories, setCategories] = useState<CategoryNode[]>(initialCategories);
  const [isDragging, setIsDragging] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Refresh categories from server
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) return;
      const data = await res.json();
      setCategories(data.categories ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active || !over || active.id === over.id) return;

      // Find the parent group for the dragged item
      const findInTree = (
        nodes: CategoryNode[],
        id: string
      ): { nodes: CategoryNode[]; parentId: string | null } | null => {
        for (const node of nodes) {
          if (node.category_id === id) return { nodes, parentId: null };
          if (node.children) {
            // Check children at this level
            const childMatch = node.children.find((c) => c.category_id === id);
            if (childMatch) return { nodes: node.children, parentId: node.category_id };
            // Recurse deeper
            const deeper = findInTree(node.children, id);
            if (deeper) return deeper;
          }
        }
        return null;
      };

      const activeResult = findInTree(categories, active.id as string);
      if (!activeResult) return;

      // Check that both items are in the same sibling group
      const overIdx = activeResult.nodes.findIndex((n) => n.category_id === over.id);
      if (overIdx === -1) {
        toast.error(fr.categories.reorderError);
        return;
      }

      const activeIdx = activeResult.nodes.findIndex(
        (n) => n.category_id === active.id
      );

      // Optimistic reorder
      const reordered = arrayMove(activeResult.nodes, activeIdx, overIdx);

      // Update tree in-place (shallow clone)
      const updateTree = (nodes: CategoryNode[]): CategoryNode[] => {
        if (nodes === activeResult.nodes) return reordered;
        return nodes.map((n) => ({
          ...n,
          children: n.children ? updateTree(n.children) : n.children,
        }));
      };

      setCategories(updateTree(categories));
      setIsDragging(true);

      // Debounce PATCH
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const orderedIds = reordered.map((n) => n.category_id);
      const parentCategoryId = activeResult.parentId;

      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/categories/reorder", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ordered_ids: orderedIds,
              parent_category_id: parentCategoryId,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            if (body.code === "mixed_parents") {
              toast.error(fr.categories.mixedParentsError);
            } else {
              toast.error(fr.categories.reorderError);
            }
            // Revert
            await fetchCategories();
          }
        } catch {
          toast.error(fr.categories.reorderError);
          await fetchCategories();
        } finally {
          setIsDragging(false);
        }
      }, CATEGORY_REORDER_DEBOUNCE_MS);
    },
    [categories, fetchCategories]
  );

  const handleCreate = async (name: string, parentCategoryId?: string) => {
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parent_category_id: parentCategoryId ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? fr.errors.generic);
        return;
      }
      toast.success(fr.categories.created);
      setShowCreateForm(false);
      await fetchCategories();
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const handleRename = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toast.error(fr.errors.generic);
        return;
      }
      toast.success(fr.categories.renamed);
      await fetchCategories();
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          body.code === "has_children"
            ? fr.categories.hasChildrenError
            : fr.categories.hasDocumentsError
        );
        return;
      }
      if (!res.ok) {
        toast.error(fr.errors.generic);
        return;
      }
      toast.success(fr.categories.deleted);
      await fetchCategories();
    } catch {
      toast.error(fr.errors.generic);
    }
  };

  const handleCreateChild = async (parentId: string, name: string) => {
    await handleCreate(name, parentId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{fr.categories.title}</h2>
        <Button size="sm" onClick={() => setShowCreateForm(true)}>
          <PlusIcon className="mr-1 h-4 w-4" />
          {fr.categories.create}
        </Button>
      </div>

      {showCreateForm && (
        <CategoryNodeForm
          open={showCreateForm}
          onOpenChange={setShowCreateForm}
          onSubmit={(name) => handleCreate(name)}
          title={fr.categories.createTitle}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div
          className={isDragging ? "pointer-events-none" : ""}
        >
          <SortableContext
            items={categories.map((c) => c.category_id)}
            strategy={verticalListSortingStrategy}
          >
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {fr.categories.empty}
              </p>
            ) : (
              categories.map((cat) => (
                <CategoryNodeComponent
                  key={cat.category_id}
                  node={cat}
                  depth={0}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onCreateChild={handleCreateChild}
                />
              ))
            )}
          </SortableContext>
        </div>
      </DndContext>
    </div>
  );
}
