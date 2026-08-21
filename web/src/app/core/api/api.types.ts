/** Shapes returned by the API, mirroring the schema modules under api/src/modules. */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Every collection endpoint returns this envelope. */
export interface Paginated<T> {
  data: T[];
  page: PageMeta;
}

/** Bounded, non-paginated collections (taxonomy) and single resources. */
export interface Wrapped<T> {
  data: T;
}

export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

export interface AuthorRef {
  id: number;
  displayName: string;
}

export interface FeedbackRequestListItem {
  id: number;
  title: string;
  excerpt: string;
  excerptTruncated: boolean;
  category: TaxonomyRef;
  status: TaxonomyRef;
  author: AuthorRef;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackRequestDetail {
  id: number;
  title: string;
  description: string;
  category: TaxonomyRef;
  status: TaxonomyRef;
  author: AuthorRef;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackRequest {
  title: string;
  description: string;
  categoryId: number;
}
