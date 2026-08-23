import { z } from 'zod';
import type { SettingControl } from './settings.registry.js';

/**
 * What a settings write looks like on the wire.
 *
 * Deliberately thin. Every other module in this application validates its body
 * field by field here, and this one cannot: the fields are the registry's, and
 * a schema listing them would be a second copy of it that drifts the first time
 * somebody adds a setting without noticing there were two places to add it.
 *
 * So this checks the envelope — an object, with something in it — and the
 * service checks each key against the definition that owns it. The error shape
 * the caller sees is identical either way: one 422 with an entry per offending
 * key.
 */
export const settingsPatchSchema = z
  .record(z.string(), z.unknown())
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'Name at least one setting to change.',
  });

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * A patch always names its target user in the path, never "whoever is calling".
 *
 * That is what makes the refusal a real one. An endpoint that wrote "your own"
 * preferences could not tell an attempt to change somebody else's from an
 * ordinary save, so it would answer 200 and quietly write the wrong row's
 * neighbour. Naming the target means the answer to writing another person's
 * preferences is 403, and there is a test that says so.
 */
export const userIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: 'The id must be a number.' })
    .int({ error: 'The id must be a whole number.' })
    .positive({ error: 'The id must be a positive number.' }),
});

/** Everything a person may change about themselves that is not a preference. */
export const DISPLAY_NAME_MAX = 120;

export const updateProfileSchema = z
  .object({
    displayName: z
      .string({ error: 'A display name is required.' })
      .trim()
      .min(1, { error: 'A display name is required.' })
      .max(DISPLAY_NAME_MAX, {
        error: `A display name cannot be longer than ${DISPLAY_NAME_MAX} characters.`,
      }),
  })
  .strict();

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

/* ── Response shapes ─────────────────────────────────────────────────────── */

/** Which layer an effective value came from. */
export type SettingSource = 'user' | 'global' | 'default';

export interface ResolvedSettingDto {
  value: unknown;
  source: SettingSource;
  editable: boolean;
}

/**
 * What the settings screens render from: the value, where it came from, and
 * enough text to label the control.
 *
 * The label and description travel with the value rather than living in the
 * client, so a setting added to the registry appears on the screen without a
 * second edit in another repository's language.
 */
export interface SettingDescriptor extends ResolvedSettingDto {
  key: string;
  label: string;
  description: string;

  /**
   * Which control edits it. Sent, rather than decided by the screen, so a
   * setting added to the registry appears on the screen it belongs to without a
   * second edit in another repository.
   */
  control: SettingControl;
}
