/**
 * Which identity implementation is compiled into this build.
 *
 * This is a leaf module with no imports so that both the configuration loader
 * and the identity seam can depend on it without a cycle. Its only job is to
 * make "which way is identity established" a fact the boot sequence can assert
 * against, rather than a convention someone has to remember.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEAM PAID OFF
 *
 * Authentication landed by changing this constant and the body of
 * resolveCurrentUser. Nothing in src/policy moved, no service learned what a
 * token is, and req.actor is still non-nullable behind the middleware.
 *
 * The development seam is retained rather than deleted, and it is retained for
 * one reason: the boot guard in src/config/env.schema.ts is the thing that
 * makes a build with an authentication bypass in it unable to start in
 * production, and a guard with no possible subject is a guard nobody can test.
 * It stays selectable — flip the constant to run locally without a container —
 * and it stays forbidden in production.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type IdentityMode = 'development-seam' | 'keycloak';

export const IDENTITY_MODE: IdentityMode = 'keycloak';
