"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
} from "lucide-react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { CategoryNode } from "@/types/categories";
import CategoryNodeForm from "./CategoryNodeForm";
import { fr } from "@/lib/messages/fr";

const MAX_DEPTH = 5;

interface CategoryNodeProps {
  node: CategoryNode;
  depth: number;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreateChild: (parentId: string, name: string) => void;
}

export default function CategoryNodeComponent({
  node,
  depth,
  onRename,
  onDelete,
  onCreateChild,
}: CategoryNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [showRename, setShowRename] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.category_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasChildren = node.children && node.children.length > 0;
  const canAddChild = depth < MAX_DEPTH - 1;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50 group"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
          aria-label={`Réordonner ${node.name}`}
          aria-grabbed={isDragging}
        >
          <GripVerticalIcon className="h-4 w-4" />
        </button>

        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5"
          aria-label={expanded ? "Réduire" : "Développer"}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDownIcon className="h-4 w-4" />
            ) : (
              <ChevronRightIcon className="h-4 w-4" />
            )
          ) : (
            <span className="inline-block w-4" />
          )}
        </button>

        {/* Name */}
        <span className="flex-1 text-sm truncate">{node.name}</span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {canAddChild && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowCreateChild(true)}
              aria-label={`Ajouter un enfant à ${node.name}`}
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowRename(true)}
            aria-label={`Renommer ${node.name}`}
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(node.category_id)}
            aria-label={`Supprimer ${node.name}`}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Rename dialog */}
      {showRename && (
        <CategoryNodeForm
          open={showRename}
          onOpenChange={setShowRename}
          onSubmit={(name) => {
            onRename(node.category_id, name);
            setShowRename(false);
          }}
          title={fr.categories.renameTitle}
          defaultValue={node.name}
        />
      )}

      {/* Create child dialog */}
      {showCreateChild && (
        <CategoryNodeForm
          open={showCreateChild}
          onOpenChange={setShowCreateChild}
          onSubmit={(name) => {
            onCreateChild(node.category_id, name);
            setShowCreateChild(false);
          }}
          title={fr.categories.createChildTitle}
        />
      )}

      {/* Children */}
      {hasChildren && expanded && (
        <SortableContext
          items={node.children!.map((c) => c.category_id)}
          strategy={verticalListSortingStrategy}
        >
          {node.children!.map((child) => (
            <CategoryNodeComponent
              key={child.category_id}
              node={child}
              depth={depth + 1}
              onRename={onRename}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}
