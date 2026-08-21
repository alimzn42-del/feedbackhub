import type { Actor } from '../auth/actor.js';
import { ForbiddenError } from '../http/errors.js';

/**
 * The one place permission rules live (decision 4).
 *
 * Handlers ask questions; they do not contain rules. If you find yourself
 * writing `if (actor.role === 'admin')` outside this directory, the rule belongs
 * in here instead.
 *
 * No permission library and no dynamic RBAC engine: two roles and roughly
 * fifteen rules do not pay for one, and a rule you can read in four lines beats
 * a rule assembled at runtime.
 */
export interface Decision {
  allowed: boolean;
  /** Why not. Sent to the caller verbatim, so write it for them. */
  reason: string;
}

export const allow = (): Decision => ({ allowed: true, reason: '' });

export const deny = (reason: string): Decision => ({ allowed: false, reason });

/** Turns a denial into the 403 the caller sees. Never a 404 — see decision 5. */
export function authorize(decision: Decision): void {
  if (!decision.allowed) {
    throw new ForbiddenError(decision.reason);
  }
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'admin';

export const isSelf = (actor: Actor, userId: number): boolean => actor.id === userId;
