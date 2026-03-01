"use client";

import CategoryTreeManager from "@/components/categories/CategoryTreeManager";
import type { CategoryNode } from "@/types/categories";

interface CategoriesClientProps {
  initialCategories: CategoryNode[];
}

export default function CategoriesClient({ initialCategories }: CategoriesClientProps) {
  return <CategoryTreeManager initialCategories={initialCategories} />;
}
