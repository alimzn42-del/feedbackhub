import type { Actor } from '../../auth/actor.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { settingPolicy } from '../../policy/settings.policy.js';
import type { UpdateProfileBody } from '../settings/settings.schema.js';
import * as usersRepository from './users.repository.js';

/**
 * The person, as the application knows them.
 *
 * Deliberately without their role. The browser is never told who it is — it is
 * told what it may do, by the per-row flags and by GET /api/capabilities — and
 * a role in this payload would be the one piece of that rule this slice quietly
 * gave up. Everything a screen wants a role for, it can ask a capability about
 * instead.
 */
export interface ProfileDto {
  id: number;
  email: string;
  displayName: string;
}

export function toProfile(actor: Actor): ProfileDto {
  return { id: actor.id, email: actor.email, displayName: actor.displayName };
}

export async function updateProfile(
  actor: Actor,
  targetUserId: number,
  body: UpdateProfileBody,
): Promise<ProfileDto> {
  authorize(settingPolicy.writeUser(actor, targetUserId));

  await usersRepository.updateDisplayName(targetUserId, body.displayName);

  const updated = await usersRepository.findById(targetUserId);

  if (!updated) {
    throw new NotFoundError('That account does not exist.');
  }

  return toProfile(updated);
}

/**
 * Leaving, which anonymises rather than deletes.
 *
 * The one refusal on top of the permission check: the last admin cannot go.
 * Not because their account is special, but because there is no user
 * administration in this application yet — nothing promotes anybody — so an
 * installation that reaches zero admins can never have one again without
 * somebody editing the database by hand. Every other rule here exists to avoid
 * exactly that dead end.
 *
 * It is a 409 and not a 403: they are allowed to do this, and the state of the
 * world is what stands in the way. The message says what would fix it.
 */
export async function deleteAccount(actor: Actor, targetUserId: number): Promise<void> {
  authorize(settingPolicy.deleteAccount(actor, targetUserId));

  const target = await usersRepository.findById(targetUserId);

  if (!target) {
    throw new NotFoundError('That account does not exist.');
  }

  if (target.role === 'admin' && (await usersRepository.countOtherAdmins(targetUserId)) === 0) {
    throw new ConflictError(
      'You are the only admin, so deleting your account would leave this board with nobody ' +
        'who can manage it. Nothing in the application can appoint another admin yet, so this ' +
        'is refused rather than offered with a way around it.',
    );
  }

  await usersRepository.anonymise(targetUserId);
}
