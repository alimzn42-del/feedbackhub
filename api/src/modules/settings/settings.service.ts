import type { Actor } from '../../auth/actor.js';
import { ValidationError } from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { settingPolicy } from '../../policy/settings.policy.js';
import * as categoriesRepository from '../categories/categories.repository.js';
import * as statusesRepository from '../statuses/statuses.repository.js';
import {
  SETTINGS,
  isSettingKey,
  type SettingKey,
  type SettingValue,
} from './settings.registry.js';
import * as settingsRepository from './settings.repository.js';
import { RESET, type SettingChange, type StoredSettings } from './settings.repository.js';
import type { SettingDescriptor } from './settings.schema.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                                 RESOLUTION
 *
 * The server resolves and the client consumes. This file is the only place the
 * merge happens, and that is the point: a client that merged too would be a
 * second implementation of these rules, and the two would disagree the first
 * time either changed.
 *
 * Three layers, nearest wins:
 *
 *   user    a row in user_settings         "you chose this"
 *   global  a row in app_settings          "an admin chose this for everybody"
 *   default the registry's fallback        "nobody has ever chosen"
 *
 * Every answer carries which layer it came from, because the client cannot
 * render the screen without it. "Using the default" and an explicit choice that
 * happens to match look identical in the value alone, and only one of them has
 * anything to reset.
 * ══════════════════════════════════════════════════════════════════════════ */

export type SettingSource = 'user' | 'global' | 'default';

export interface ResolvedSetting {
  value: unknown;
  source: SettingSource;

  /**
   * Whether this caller may write it at their own level. Sent alongside the
   * value for the same reason canVote is sent alongside a request: the screen
   * has to decide whether to render a control, and it must not decide by
   * working out who it is.
   */
  editable: boolean;
}

export type EffectiveSettings = Record<string, ResolvedSetting>;

/**
 * One key, resolved against values already read.
 *
 * Takes the maps rather than reading them, so resolving forty keys is two
 * queries and not eighty.
 */
function resolveOne(
  key: SettingKey,
  global: StoredSettings,
  user: StoredSettings | null,
): { value: unknown; source: SettingSource } {
  const definition = SETTINGS[key];

  /**
   * A stored value is validated on the way OUT as well as on the way in.
   *
   * The value column is JSON and a row may have been written by an earlier
   * build of this registry, under rules this one no longer holds — a sort
   * option that has since been removed, a number outside a range that has since
   * tightened. Serving it would push a value the application no longer believes
   * in out to every caller. Falling through to the next layer degrades to the
   * default instead, which is a state the application definitely handles.
   */
  const accept = (stored: unknown): boolean => definition.schema.safeParse(stored).success;

  if (definition.scope !== 'global' && user?.has(key)) {
    const stored = user.get(key);
    if (accept(stored)) return { value: stored, source: 'user' };
  }

  if (definition.scope !== 'user' && global.has(key)) {
    const stored = global.get(key);
    if (accept(stored)) return { value: stored, source: 'global' };
  }

  return { value: definition.fallback, source: 'default' };
}

/**
 * Everything this caller is allowed to see, resolved.
 *
 * An admin-only setting is ABSENT from a non-admin's payload rather than
 * present and uneditable. This is the one place in the application where a
 * field is withheld rather than merely refused on write, and it is deliberate:
 * the rate limit and the registration policy describe how the installation is
 * run, and that is not a fact every account is owed.
 *
 * Where such a setting changes what happens to somebody, the consequence still
 * reaches them — as an answer about their own action, from the endpoint that
 * owns it, the same way every permission answer travels. See `awaitsApproval`
 * on the comment thread.
 */
export async function effectiveFor(actor: Actor): Promise<EffectiveSettings> {
  const [global, user] = await Promise.all([
    settingsRepository.readGlobal(),
    settingsRepository.readForUser(actor.id),
  ]);

  const effective: EffectiveSettings = {};

  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const definition = SETTINGS[key];

    if (!settingPolicy.read(actor, definition.visibility).allowed) continue;

    effective[key] = {
      ...resolveOne(key, global, user),
      editable:
        definition.scope === 'global'
          ? settingPolicy.writeGlobal(actor).allowed
          : // A personal setting is always the caller's own to write; a
            // `both` key is overridable by anybody for themselves.
            true,
    };
  }

  return effective;
}

/**
 * The subset the shell cannot draw itself without.
 *
 * Which keys those are is declared on each definition rather than listed here,
 * so adding a setting that matters at first paint is one edit and not two.
 */
export async function firstPaintFor(actor: Actor): Promise<EffectiveSettings> {
  const effective = await effectiveFor(actor);

  return Object.fromEntries(
    Object.entries(effective).filter(([key]) => SETTINGS[key as SettingKey].firstPaint),
  );
}

/**
 * What a settings SCREEN needs: the resolved value plus the words to label the
 * control with.
 *
 * The labels travel with the values because they belong to the setting, and the
 * setting is defined in one file. A client holding its own copy of them would
 * render an empty row for a setting it had not been taught about yet.
 */
export async function describe(
  actor: Actor,
  level: 'global' | 'user',
): Promise<SettingDescriptor[]> {
  if (level === 'global') authorize(settingPolicy.readGlobal(actor));

  const effective = await effectiveFor(actor);

  return (Object.keys(SETTINGS) as SettingKey[])
    .filter((key) => {
      const scope = SETTINGS[key].scope;
      return level === 'global' ? scope !== 'user' : scope !== 'global';
    })
    .filter((key) => key in effective)
    .map((key) => ({
      key,
      label: SETTINGS[key].label,
      description: SETTINGS[key].description,
      control: SETTINGS[key].control,
      ...(effective[key] as ResolvedSetting),
    }));
}

/**
 * One global setting, typed, for the code that has to behave differently
 * because of it.
 *
 * Not authorized: this is the application asking itself how it is configured,
 * not a caller asking to be told. The rate limiter and the comment reader use
 * it; neither is answering a question about who is calling.
 *
 * Read every time rather than cached, for the same reason the identity seam
 * looks the user up on every request: a setting whose effect appears at the
 * next restart is not a setting anybody can try. The read is one query against
 * a table with fewer rows than this registry has keys.
 */
export async function globalValue<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const global = await settingsRepository.readGlobal();
  return resolveOne(key, global, null).value as SettingValue<K>;
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * `null` means reset — remove the stored value and go back to what the layer
 * below says. It is the only value with a meaning of its own, and no setting in
 * the registry is nullable, so nothing is ambiguous about it.
 */
export type SettingPatch = Record<string, unknown>;

interface Validated {
  changes: Map<string, SettingChange>;
  /** The values as they will stand after the write, for cross-key checks. */
  after: Map<SettingKey, unknown>;
}

function validate(
  patch: SettingPatch,
  level: 'global' | 'user',
  current: (key: SettingKey) => unknown,
): Validated {
  const changes = new Map<string, SettingChange>();
  const after = new Map<SettingKey, unknown>();
  const issues: { field: string; code: string; message: string }[] = [];

  for (const [key, raw] of Object.entries(patch)) {
    if (!isSettingKey(key)) {
      issues.push({
        field: key,
        code: 'UNKNOWN_SETTING',
        message: `There is no setting called "${key}".`,
      });
      continue;
    }

    const definition = SETTINGS[key];

    /**
     * A setting written at a level it does not live at is refused by name
     * rather than dropped. Silently ignoring it would tell the caller their
     * change was saved and then show them the old value on the next read.
     */
    const permitted = level === 'global' ? definition.scope !== 'user' : definition.scope !== 'global';

    if (!permitted) {
      issues.push({
        field: key,
        code: 'WRONG_LEVEL',
        message:
          level === 'global'
            ? `"${key}" is a personal setting and has no value for the whole installation.`
            : `"${key}" is set for the whole installation and cannot be overridden per person.`,
      });
      continue;
    }

    if (raw === null) {
      changes.set(key, RESET);
      after.set(key, undefined);
      continue;
    }

    const parsed = definition.schema.safeParse(raw);

    if (!parsed.success) {
      issues.push({
        field: key,
        code: 'INVALID_VALUE',
        message: parsed.error.issues[0]?.message ?? 'That value is not allowed for this setting.',
      });
      continue;
    }

    changes.set(key, { value: parsed.data });
    after.set(key, parsed.data);
  }

  if (issues.length > 0) {
    throw new ValidationError('The submitted settings are not valid.', issues);
  }

  // Keys the patch did not mention still take part in the checks below, at
  // whatever they resolve to today.
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    if (!after.has(key)) after.set(key, current(key));
  }

  // A reset resolves to the layer underneath, which for a global reset is the
  // registry's fallback.
  for (const [key, value] of after) {
    if (value === undefined) after.set(key, SETTINGS[key].fallback);
  }

  return { changes, after };
}

/**
 * The invariant the two registration keys hold together, which neither can hold
 * alone.
 *
 * Restricting registration to a list of domains and leaving the list empty
 * admits nobody. That is a closed board wearing the clothes of a restricted
 * one: every applicant is refused, the setting screen reads as configured, and
 * the reason is invisible. Refused as a pair, which is why writes arrive as a
 * set and land in one transaction.
 */
function assertRegistrationIsCoherent(after: Map<SettingKey, unknown>): void {
  const policy = after.get('registration.policy');
  const domains = after.get('registration.allowedDomains') as string[];

  if (policy === 'domains' && domains.length === 0) {
    throw new ValidationError('The submitted settings are not valid.', [
      {
        field: 'registration.allowedDomains',
        code: 'REQUIRED',
        message:
          'Name at least one domain, or set registration back to open. Restricting to an empty list would refuse everybody.',
      },
    ]);
  }
}

/**
 * Default filters must name taxonomy rows that exist.
 *
 * The board refuses a filter value that names nothing — that rule is what stops
 * an unfiltered board being mistaken for a filter that matched everything. A
 * preference holding a slug nothing answers to would therefore land somebody on
 * a 422 every time they opened the board, so it is caught here instead, once,
 * when it is written.
 */
async function assertDefaultFiltersExist(after: Map<SettingKey, unknown>): Promise<void> {
  const statuses = after.get('board.defaultStatuses') as string[];
  const categories = after.get('board.defaultCategories') as string[];

  if (statuses.length === 0 && categories.length === 0) return;

  const [knownStatuses, knownCategories] = await Promise.all([
    statusesRepository.listActive(),
    categoriesRepository.listActive(),
  ]);

  const issues = [
    ...unknownSlugs(statuses, knownStatuses, 'board.defaultStatuses', 'status'),
    ...unknownSlugs(categories, knownCategories, 'board.defaultCategories', 'category'),
  ];

  if (issues.length > 0) {
    throw new ValidationError('The submitted settings are not valid.', issues);
  }
}

function unknownSlugs(
  wanted: string[],
  known: { slug: string }[],
  field: string,
  noun: string,
): { field: string; code: string; message: string }[] {
  const slugs = new Set(known.map((row) => row.slug));

  return wanted
    .filter((slug) => !slugs.has(slug))
    .map((slug) => ({
      field,
      code: 'UNKNOWN',
      message: `There is no ${noun} called "${slug}".`,
    }));
}

export async function updateGlobal(actor: Actor, patch: SettingPatch): Promise<EffectiveSettings> {
  authorize(settingPolicy.writeGlobal(actor));

  const global = await settingsRepository.readGlobal();
  const { changes, after } = validate(patch, 'global', (key) => resolveOne(key, global, null).value);

  assertRegistrationIsCoherent(after);
  await assertDefaultFiltersExist(after);

  await settingsRepository.applyGlobal(changes, actor.id);

  return effectiveFor(actor);
}

/**
 * Writing somebody's preferences, which is only ever your own.
 *
 * The target is named in the path rather than implied, so the refusal is a real
 * one: a caller who asks to write another person's preferences is told no,
 * instead of quietly writing their own and being told it worked.
 */
export async function updateForUser(
  actor: Actor,
  targetUserId: number,
  patch: SettingPatch,
): Promise<EffectiveSettings> {
  authorize(settingPolicy.writeUser(actor, targetUserId));

  const [global, user] = await Promise.all([
    settingsRepository.readGlobal(),
    settingsRepository.readForUser(targetUserId),
  ]);

  const { changes, after } = validate(patch, 'user', (key) => resolveOne(key, global, user).value);

  await assertDefaultFiltersExist(after);

  await settingsRepository.applyForUser(targetUserId, changes);

  return effectiveFor(actor);
}
