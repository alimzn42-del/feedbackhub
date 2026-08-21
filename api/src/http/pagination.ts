import { z } from 'zod';

/**
 * The list envelope, fixed from this slice onward. Every collection endpoint
 * returns this shape unchanged, so the client has one thing to understand.
 *
 * Offset pagination rather than keyset: the UI shows page numbers and a total,
 * which keyset cannot express, and this board will never hold enough rows for
 * deep-offset cost to matter.
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  page: PageMeta;
}

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: 'Page must be a number.' })
    .int({ error: 'Page must be a whole number.' })
    .min(1, { error: 'Page starts at 1.' })
    .default(1),
  pageSize: z.coerce
    .number({ error: 'Page size must be a number.' })
    .int({ error: 'Page size must be a whole number.' })
    .min(1, { error: 'Page size must be at least 1.' })
    .max(MAX_PAGE_SIZE, { error: `Page size cannot exceed ${MAX_PAGE_SIZE}.` })
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toPageMeta(query: PaginationQuery, total: number): PageMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

export function toOffset(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}
