import { z } from 'zod';
import { IDENTITY_MODE } from '../auth/identity-mode.js';

/**
 * The shape of the environment, and the guards that run over it at boot.
 *
 * Nothing here reads process.env or has any other side effect — ./env.ts is the
 * only module that does, and it is the only module permitted to. A missing or
 * malformed variable stops the process with a message naming it, rather than
 * surfacing as an undefined three layers down.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:4200'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(1000).default(10),

  /**
   * Development-only. Selects which seeded user every request runs as.
   * Required while IDENTITY_MODE is the development seam, and forbidden in
   * production — see assertIdentityIsSafeFor below.
   */
  DEV_CURRENT_USER_EMAIL: z.email().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
}

/**
 * The structural lock on the development identity seam.
 *
 * The seam accepts an unauthenticated request and hands it a fully privileged
 * identity chosen by an environment variable. That is exactly right in
 * development and is a total authentication bypass anywhere else, so reaching a
 * production environment with it compiled in must be impossible, not merely
 * discouraged. This is a hard boot failure, not a warning that scrolls past.
 *
 * Exported separately from the loader so it can be tested without the test
 * having to tear down the process.
 */
export function assertIdentityIsSafeFor(env: Env, identityMode = IDENTITY_MODE): void {
  if (identityMode === 'development-seam') {
    if (env.NODE_ENV === 'production') {
      throw new EnvironmentError(
        'Refusing to start: the development identity seam is compiled into this build ' +
          'while NODE_ENV=production. The seam authenticates nobody and grants the ' +
          'identity named by DEV_CURRENT_USER_EMAIL to every caller. Switch ' +
          'IDENTITY_MODE in src/auth/identity-mode.ts to a real provider before ' +
          'deploying.',
      );
    }

    if (!env.DEV_CURRENT_USER_EMAIL) {
      throw new EnvironmentError(
        'DEV_CURRENT_USER_EMAIL is required while the development identity seam is ' +
          'in use: without it no request has an identity. Set it to one of the seeded ' +
          'users, for example admin@feedbackhub.local.',
      );
    }
  }

  if (identityMode !== 'development-seam' && env.DEV_CURRENT_USER_EMAIL) {
    throw new EnvironmentError(
      'DEV_CURRENT_USER_EMAIL is set but this build uses a real identity provider. ' +
        'Remove it so nobody mistakes it for something that still has an effect.',
    );
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvironmentError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  assertIdentityIsSafeFor(result.data);
  return result.data;
}
