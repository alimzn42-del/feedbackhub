import { z } from 'zod';
import { DEFAULT_SORT, SORT_OPTIONS } from '../requests/requests.schema.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                              THE SETTING REGISTRY
 *
 * Where a setting is defined. Not the tables — they only hold whatever was set,
 * and a table with no row for a key is the normal state rather than a missing
 * one.
 *
 * Everything about a setting is here in one entry: what it accepts, what it
 * falls back to, which levels may hold it, and who is allowed to see it. That
 * is deliberate. The alternative is a default in the service, a validator in a
 * schema file, a permission check in a controller and a column in a migration —
 * four places to keep in step, and four chances for a setting to accept a value
 * one of them does not believe in.
 *
 * Adding a setting is an entry below and nothing else. No migration, because
 * the row is optional; no schema change, because the value column is JSON; no
 * new branch in the resolver, because it reads this table of definitions rather
 * than knowing the keys.
 *
 * The rule that keeps it honest: nothing outside this directory may name a
 * storage detail. Call sites ask for a key and get a typed value.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which levels may hold a value for this key.
 *
 * `both` is the only one that resolves — a global value that a person may
 * override. The other two exist to make the wrong write refusable by name: a
 * user cannot set the registration policy, and the installation has no opinion
 * about anybody's colour scheme.
 */
export type SettingScope = 'global' | 'user' | 'both';

/**
 * Who may read this key's value.
 *
 * `admin` means withheld, not merely uneditable — an administrative setting is
 * absent from a non-admin's payload entirely. This is the one place in the
 * application where a field is hidden rather than just refused on write, and it
 * only holds for the value itself. Where a setting changes what happens to
 * somebody, that consequence still reaches them: see `comments.requireApproval`
 * below.
 */
export type SettingVisibility = 'everyone' | 'admin';

export interface SettingDefinition<T> {
  scope: SettingScope;
  visibility: SettingVisibility;

  /**
   * Validates every write, at both levels, and every read out of the database.
   *
   * Reads are validated too, because the value column is JSON and a row written
   * by an older build of this registry may no longer satisfy it. A stored value
   * that fails is treated as absent rather than served — see the resolver.
   */
  schema: z.ZodType<T>;

  /**
   * What the setting is when nobody has ever set it.
   *
   * In code rather than in a seeded row on purpose: it is the answer to "what
   * does this application do out of the box", which is a fact about this build.
   * Keeping it here is also what makes the third source distinguishable — a
   * global row that an admin actually chose reads differently from one that
   * never existed, and the admin screen needs to tell them apart to offer a
   * reset.
   */
  fallback: T;

  /**
   * Whether the first screen cannot be drawn correctly without this value.
   *
   * The bootstrap payload carries exactly these, and the settings screens fetch
   * the rest when somebody opens them. It is declared here, with the setting,
   * rather than as a list in the bootstrap controller — a list somewhere else
   * is a thing to forget when a setting is added.
   *
   * The test for it is narrow on purpose: not "the screen wants it" but "the
   * screen would be drawn wrong without it, and then visibly change". A colour
   * scheme applied after first paint is a flash of the wrong one; an email
   * preference read on a screen nobody has opened yet is not.
   */
  firstPaint: boolean;

  /**
   * What kind of control edits it, and what that control needs to know.
   *
   * Here rather than in the client for the same reason as everything else in
   * this entry. A screen that decided per key which control to draw would be a
   * second list of the settings, kept in another language, in another
   * repository, updated by somebody who has to remember it exists — and a
   * setting added without that second edit would simply not appear, silently.
   *
   * The client renders whatever it is sent and refuses nothing: the value is
   * validated here, on the way in, against the same schema above.
   */
  control: SettingControl;

  /** Shown on the settings screens. Written for the person changing it. */
  label: string;
  description: string;
}

/**
 * The controls this application has. Deliberately a short list — a settings
 * screen that can render anything is a form builder, and nobody asked for one.
 */
export type SettingControl =
  | { kind: 'toggle' }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'choice'; options: { value: string; label: string }[] }
  /** A multi-select over a taxonomy the board already knows about. */
  | { kind: 'slugs'; source: 'categories' | 'statuses' }
  /** A free list of strings, one per line. */
  | { kind: 'lines'; placeholder: string };

function define<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  return definition;
}

/** A slug, as the taxonomy mints them. Validated against the real rows on write. */
const slugList = z.array(z.string().min(1).max(60)).max(20);

export const SETTINGS = {
  /* ── Application: who gets in ─────────────────────────────────────────── */

  /**
   * Checked when a person is provisioned, which is the moment their first
   * authenticated request arrives and no local row exists yet.
   *
   * `invite-only` is deliberately not one of the values. There is no invitation
   * to check against — no table, nothing that mints one — so the setting would
   * name a rule the application cannot apply, and would in practice mean
   * "closed" while claiming to mean something else. It arrives with invitations
   * or not at all.
   */
  'registration.policy': define({
    scope: 'global',
    visibility: 'admin',
    schema: z.enum(['open', 'domains']),
    fallback: 'open' as 'open' | 'domains',
    firstPaint: false,
    control: {
      kind: 'choice',
      options: [
        { value: 'open', label: 'Anybody who signs in' },
        { value: 'domains', label: 'Only the email domains below' },
      ],
    },
    label: 'Who may create an account',
    description:
      'Open lets anybody who authenticates get an account. Restricted admits only the email domains listed below.',
  }),

  /**
   * Only consulted while the policy is `domains`, and required to be non-empty
   * then: a domain restriction with no domains admits nobody, which is a
   * closed board that looks like an open one. The service refuses that pairing
   * rather than storing it.
   */
  'registration.allowedDomains': define({
    scope: 'global',
    visibility: 'admin',
    schema: z.array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(3)
        .max(253)
        .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
          error: 'Write a domain like "example.com", without the @.',
        }),
    ),
    fallback: [] as string[],
    firstPaint: false,
    control: { kind: 'lines', placeholder: 'example.com' },
    label: 'Allowed email domains',
    description: 'Used only while registration is restricted.',
  }),

  /* ── Application: the feature flag ────────────────────────────────────── */

  /**
   * THE FEATURE FLAG.
   *
   * When it is on, a new comment is visible to its author and to admins, and to
   * nobody else, until an admin approves it. It was chosen over the alternatives
   * because it changes what the application DOES rather than what it shows: the
   * comment is written, stored and answered for, and the difference is who the
   * server will serve it to. A flag that hides a button proves only that a
   * button can be hidden.
   *
   * Withheld from non-admins, like every setting here — but the consequence is
   * not. Somebody whose comment will wait has to be told so before they write
   * it and after they post it, or the interface is lying to them. That reaches
   * them the way every other permission answer does: as an answer about their
   * own action, on the endpoint that owns it. GET /api/requests/:id/comments
   * carries `awaitsApproval`, and a comment of their own carries `isPending`.
   * The setting itself never crosses the wire to them.
   */
  'comments.requireApproval': define({
    scope: 'global',
    visibility: 'admin',
    schema: z.boolean(),
    fallback: false,
    firstPaint: false,
    control: { kind: 'toggle' },
    label: 'Approve comments before they appear',
    description:
      'A new comment waits for an admin. Its author can see it while it waits; nobody else can. Turning this off releases everything still waiting.',
  }),

  /* ── Application: the rate limit ──────────────────────────────────────── */

  /**
   * How many requests one person may file in a rolling day.
   *
   * A setting rather than a constant, which is the whole point of it being
   * here: the number is an operational judgement that changes with the size of
   * the board, and changing it should not be a deploy.
   *
   * Zero is not "unlimited" — it would be a board nobody can post to, which is
   * a state an admin can reach by accident and cannot tell from a bug. The
   * minimum is one; unlimited is expressed by a number nobody reaches.
   */
  'submissions.perUserPerDay': define({
    scope: 'global',
    visibility: 'admin',
    schema: z.number().int().min(1).max(1000),
    fallback: 20,
    firstPaint: false,
    control: { kind: 'number', min: 1, max: 1000 },
    label: 'Requests one person may file per day',
    description:
      'Counted over the last 24 hours, not per calendar day, so the limit does not reset at a moment somebody has to guess.',
  }),

  /* ── Both levels: the board's opening state ───────────────────────────── */

  /**
   * The ordering the board opens on — the setting the brief singles out,
   * because it is the clear case of a value existing at both levels.
   *
   * The installation has a default and a person may want another. Neither is
   * more correct, and the client is told which one it got so it can offer to
   * go back.
   */
  'board.defaultSort': define({
    scope: 'both',
    visibility: 'everyone',
    schema: z.enum(SORT_OPTIONS),
    fallback: DEFAULT_SORT,
    firstPaint: true,
    control: {
      kind: 'choice',
      options: [
        { value: 'newest', label: 'Newest first' },
        { value: 'oldest', label: 'Oldest first' },
        { value: 'votes', label: 'Most voted' },
      ],
    },
    label: 'Order the board opens on',
    description: 'Applied when you arrive at the board without an ordering in the address.',
  }),

  /**
   * Statuses and categories the board opens filtered by, named by slug.
   *
   * Slugs rather than ids, matching the filters themselves — the id of a status
   * is an implementation detail nobody has shared a link to. Validated against
   * the real taxonomy on write, so a preference cannot name something that does
   * not exist and turn the board into a 422 on arrival.
   *
   * How this coexists with list state living in the URL is the interesting
   * part, and it is the client's job: arriving at the board with no query at
   * all replaces the address with one carrying these defaults. The preference
   * decides where you land; the URL still says where you are.
   */
  'board.defaultStatuses': define({
    scope: 'both',
    visibility: 'everyone',
    schema: slugList,
    fallback: [] as string[],
    firstPaint: true,
    control: { kind: 'slugs', source: 'statuses' },
    label: 'Statuses the board opens filtered by',
    description: 'Leave empty to open on everything.',
  }),

  'board.defaultCategories': define({
    scope: 'both',
    visibility: 'everyone',
    schema: slugList,
    fallback: [] as string[],
    firstPaint: true,
    control: { kind: 'slugs', source: 'categories' },
    label: 'Categories the board opens filtered by',
    description: 'Leave empty to open on everything.',
  }),

  /* ── Personal: presentation ───────────────────────────────────────────── */

  /**
   * `system` follows the operating system and is the fallback, so the
   * application looks like the machine it is running on until somebody says
   * otherwise. It is a real value rather than the absence of one: "I want this
   * to follow my machine" and "I have never chosen" render the same and are not
   * the same statement.
   *
   * No global level. An installation having an opinion about one person's
   * colour scheme is not a default, it is an override wearing a default's
   * clothes.
   */
  'profile.theme': define({
    scope: 'user',
    visibility: 'everyone',
    schema: z.enum(['light', 'dark', 'system']),
    fallback: 'system' as 'light' | 'dark' | 'system',
    firstPaint: true,
    control: {
      kind: 'choice',
      options: [
        { value: 'system', label: 'Follow my device' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
    },
    label: 'Colour scheme',
    description: 'System follows the setting on your device.',
  }),

  /**
   * What this actually does, stated plainly because the honest scope is smaller
   * than the word suggests: it sets the document language and the locale dates
   * and numbers are formatted in. The interface copy is not translated — there
   * is no message catalogue and pretending otherwise with a half-populated one
   * would be worse than not offering it.
   */
  'profile.language': define({
    scope: 'user',
    visibility: 'everyone',
    schema: z.enum(['en', 'fr', 'de']),
    fallback: 'en' as 'en' | 'fr' | 'de',
    firstPaint: true,
    control: {
      kind: 'choice',
      options: [
        { value: 'en', label: 'English' },
        { value: 'fr', label: 'Français' },
        { value: 'de', label: 'Deutsch' },
      ],
    },
    label: 'Language and formatting',
    description: 'Sets the document language and how dates and numbers are written.',
  }),

  /* ── Personal: notifications ──────────────────────────────────────────── */

  /**
   * Recorded, and nothing sends mail. There is no mailer in this application
   * and this slice does not add one.
   *
   * That would normally be dead weight — the rule this schema has applied three
   * times is that a column nothing reads or writes should not exist yet. It
   * survives here because the storage design changes the cost: these are not
   * columns. Nothing exists until somebody sets one, an unset preference is
   * answered from the fallback above, and removing them later is deleting an
   * entry from this file. Recording an intention that costs nothing to hold is
   * different from carving out a column to hold it in.
   */
  'notifications.emailOnComment': define({
    scope: 'user',
    visibility: 'everyone',
    schema: z.boolean(),
    fallback: true,
    firstPaint: false,
    control: { kind: 'toggle' },
    label: 'Email me when somebody comments on my request',
    description: 'Recorded now; no mail is sent until this application can send it.',
  }),

  'notifications.emailOnStatusChange': define({
    scope: 'user',
    visibility: 'everyone',
    schema: z.boolean(),
    fallback: true,
    firstPaint: false,
    control: { kind: 'toggle' },
    label: 'Email me when the status of my request changes',
    description: 'Recorded now; no mail is sent until this application can send it.',
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;

/** The type a given key holds, taken from its own validator. */
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** Keys that may be written at the level named. */
export const globalKeys = (): SettingKey[] =>
  SETTING_KEYS.filter((key) => SETTINGS[key].scope !== 'user');

export const userKeys = (): SettingKey[] =>
  SETTING_KEYS.filter((key) => SETTINGS[key].scope !== 'global');
