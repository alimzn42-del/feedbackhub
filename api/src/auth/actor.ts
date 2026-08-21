/**
 * The identity every authorization decision is made about.
 *
 * Role lives here because it lives in the local users table (decision 3), not
 * because a token said so. When authentication arrives, the token establishes
 * *which* user this is; it does not establish what they may do.
 */
export type Role = 'user' | 'admin';

export interface Actor {
  id: number;
  externalId: string | null;
  email: string;
  displayName: string;
  role: Role;
}
