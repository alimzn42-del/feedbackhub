import { createHash } from 'node:crypto';

/**
 * A one-way fingerprint of an identity provider's `sub`.
 *
 * Written when an account is anonymised and compared when a subject asks for a
 * new one, so that the token somebody was already holding cannot walk straight
 * back in and be provisioned a second account — see
 * 013.do.deleted_subject_grace.sql, which is where the reasoning lives.
 *
 * A hash rather than the subject itself because the row it is stored on has had
 * every other identifying field cleared, and putting the provider's identifier
 * back on it would undo that. The only question ever asked of this value is
 * whether it equals the hash of a subject the API is holding, and equality is
 * all a hash needs to answer.
 *
 * Unsalted deliberately. A per-row salt would make the comparison impossible —
 * there is nothing to look the salt up by — and the input is a version-4 UUID
 * from the realm, not a value in a dictionary anybody could run through this.
 */
export function hashSubject(subject: string): string {
  return createHash('sha256').update(subject).digest('hex');
}

/**
 * How long after leaving a subject is refused a new account.
 *
 * The realm's access token lives 300 seconds
 * (`keycloak/realm-feedbackhub-development.json`, `accessTokenLifespan`), and
 * that is exactly the window in which a token minted before the deletion is
 * still presentable. Longer would refuse people who genuinely came back;
 * shorter would leave part of the window open, which is the whole failure.
 */
export const DEPARTURE_GRACE_SECONDS = 300;
