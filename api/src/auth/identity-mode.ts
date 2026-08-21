/**
 * Which identity implementation is compiled into this build.
 *
 * This is a leaf module with no imports so that both the configuration loader
 * and the identity seam can depend on it without a cycle. Its only job is to
 * make "the development backdoor is switched on" a fact the boot sequence can
 * assert against, rather than a convention someone has to remember.
 *
 * The authentication slice changes this constant to 'keycloak' and rewrites the
 * body of resolveCurrentUser. Nothing else moves.
 */
export type IdentityMode = 'development-seam' | 'keycloak';

export const IDENTITY_MODE: IdentityMode = 'development-seam';
