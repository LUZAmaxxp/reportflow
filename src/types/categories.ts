export interface CategoryNode {
  category_id: string;
  name: string;
  path: string;
  parent_category_id: string | null;
  sort_order: number;
  children?: CategoryNode[];
}

export interface CategoriesReorderRequest {
  ordered_ids: string[];
  parent_category_id: string | null;
}
