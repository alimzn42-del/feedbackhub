import { z } from 'zod';

/**
 * The contract shared by the two taxonomies an admin curates.
 *
 * Categories and statuses have the same shape and nearly the same rules, so the
 * pieces that are genuinely identical live here once. Where they differ they
 * differ in their own modules, and loudly: a category can be retired and a
 * status cannot, a status has a default and a category does not.
 */

export const NAME_MAX = 60;
export const SLUG_MAX = 60;

/** What the taxonomy tables actually mint: lowercase words joined by hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const nameSchema = z
  .string({ error: 'A name is required.' })
  .trim()
  .min(1, { error: 'A name is required.' })
  .max(NAME_MAX, { error: `The name cannot be longer than ${NAME_MAX} characters.` });

/**
 * Set once, at creation, and never again.
 *
 * The slug travels in the URL as a filter, so changing it breaks links people
 * have already shared. That is the entire reason the table carries both a name
 * and a slug: the name is a label an admin may reword freely, the slug is the
 * handle those links depend on. There is deliberately no endpoint that changes
 * it — not a validation rule that could be relaxed, an absence.
 */
export const slugSchema = z
  .string({ error: 'A slug is required.' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'A slug is required.' })
  .max(SLUG_MAX, { error: `The slug cannot be longer than ${SLUG_MAX} characters.` })
  .regex(SLUG_PATTERN, {
    error: 'A slug is lowercase words joined by hyphens, like "in-progress".',
  });

export const createTaxonomyBodySchema = z
  .object({
    name: nameSchema,
    slug: slugSchema,
  })
  .strict();

export type CreateTaxonomyBody = z.infer<typeof createTaxonomyBodySchema>;

/**
 * Renaming, and only renaming.
 *
 * `slug` is absent rather than optional-and-ignored: .strict() then refuses it
 * by name, so an attempt to change one is answered instead of silently dropped.
 */
export const renameTaxonomyBodySchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type RenameTaxonomyBody = z.infer<typeof renameTaxonomyBodySchema>;

/**
 * Reordering sends the WHOLE order, not one row's new position.
 *
 * Two rows swapping is two writes, and a per-row endpoint makes that two
 * requests that can half-succeed and leave the list in an order nobody chose.
 * One list, one transaction, and the position is the index — so there are no
 * gaps to accumulate and no arithmetic to get wrong.
 */
export const reorderBodySchema = z
  .object({
    ids: z
      .array(
        z.coerce
          .number({ error: 'Each id must be a number.' })
          .int({ error: 'Each id must be a whole number.' })
          .positive({ error: 'Each id must be a positive number.' }),
      )
      .min(1, { error: 'Send the ids in the order they should appear.' }),
  })
  .strict();

export type ReorderBody = z.infer<typeof reorderBodySchema>;

/** Shared by every route that names a taxonomy row in its path. */
export const taxonomyIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: 'The id must be a number.' })
    .int({ error: 'The id must be a whole number.' })
    .positive({ error: 'The id must be a positive number.' }),
});

/**
 * Whether the admin listing is wanted, rather than the one every screen uses.
 *
 * The default listing is what a selector needs: active rows, name and slug. The
 * managed one carries the display order, the retirement state and the usage
 * count, and is admin-only — so it is asked for explicitly rather than served to
 * everybody and filtered in the browser.
 */
export const taxonomyQuerySchema = z
  .object({
    scope: z
      .enum(['active', 'all'], { error: 'Scope must be "active" or "all".' })
      .default('active'),
  })
  .strict();

export type TaxonomyQuery = z.infer<typeof taxonomyQuerySchema>;

/* ── Response shapes ─────────────────────────────────────────────────────── */

/** What a selector needs, and nothing else. */
export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

/** What the admin screen needs to make a decision. */
export interface TaxonomyAdminRow extends TaxonomyRef {
  /** Position in every list this taxonomy appears in. */
  sortOrder: number;

  /**
   * How many requests carry this row.
   *
   * Shown so retiring is an informed decision rather than a guess. It does not
   * block anything: retirement exists precisely so those requests keep
   * rendering what they already point at.
   */
  requestCount: number;
}

export interface CategoryAdminRow extends TaxonomyAdminRow {
  /** When it was retired, or null while it is still offered. */
  archivedAt: string | null;
}

export interface StatusAdminRow extends TaxonomyAdminRow {
  /** The status a new request receives. Exactly one row has this. */
  isDefault: boolean;
}
