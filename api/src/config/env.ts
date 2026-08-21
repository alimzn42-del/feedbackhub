import { parseEnv, type Env } from './env.schema.js';

/**
 * The loaded, validated configuration — the single instance the application
 * runs on. Importing this module reads and checks the environment; the schema
 * and the guards themselves live in ./env.schema.ts so that tests can exercise
 * them without a module import being able to end the process.
 */
function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // A boot-time configuration failure is not recoverable and a stack trace
    // helps nobody. Print what is wrong and stop, before anything connects.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';

export type { Env } from './env.schema.js';
