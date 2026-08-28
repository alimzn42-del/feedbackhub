import { SignJWT, importJWK, exportSPKI, importJWK as _importJWK, type JWK } from 'jose';
import { inject } from 'vitest';
import type { Test } from 'supertest';

/* ════════════════════════════════════════════════════════════════════════════
 *                          ACTING AS SOMEBODY, AT L1
 *
 * At L0 which person a request acts as is decided by what the mocked users
 * repository returns. There is no mocked repository here, so it is decided the
 * way the deployment decides it: by the `sub` in the token, matched against
 * users.external_id, with provisioning and email reconciliation running for
 * real underneath.
 *
 * That is the point of the layer. Almost every row in sections 1 and 2 of the
 * plan is about what happens on that path — a newcomer, a moved address, a
 * collision, an anonymised row whose token has not expired yet — and none of it
 * is reachable while the repository is a vi.fn.
 *
 * The three subjects below are the ones src/db/seeds/001_baseline.sql pins, and
 * they are the same three the development realm pins. Change them there and
 * change them here.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface Person {
  sub: string;
  email: string;
  displayName: string;
}

export const ADMIN: Person = {
  sub: '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a01',
  email: 'admin@feedbackhub.local',
  displayName: 'Robin Alvarez',
};

export const DANA: Person = {
  sub: '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a02',
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
};

export const SAM: Person = {
  sub: '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a03',
  email: 'sam@feedbackhub.local',
  displayName: 'Sam Lindqvist',
};

/** Somebody the realm knows and the database does not. */
export const NEWCOMER: Person = {
  sub: '3f2a9c14-7d51-4c8e-9b62-1a0d5e8f4a99',
  email: 'newcomer@feedbackhub.local',
  displayName: 'Nadia Carver',
};

const l1 = inject('l1');

export const ISSUER = process.env.OIDC_ISSUER_URL as string;
export const AUDIENCE = process.env.OIDC_AUDIENCE as string;

let signingKey: CryptoKey | Uint8Array | null = null;

async function key() {
  signingKey ??= (await importJWK(l1.privateJwk as JWK, 'RS256')) as CryptoKey;
  return signingKey;
}

export interface MintOptions {
  subject?: string;
  email?: string | null;
  emailVerified?: boolean | string | null;
  displayName?: string | null;
  preferredUsername?: string | null;
  issuer?: string;
  /** A single value, an array, or null for a token carrying no `aud` at all. */
  audience?: string | string[] | null;
  azp?: string;
  expiresInSeconds?: number;
  notBeforeSeconds?: number;
  kid?: string;
  extraClaims?: Record<string, unknown>;
}

/** A token signed by the key the harness publishes. */
export async function mintToken(options: MintOptions = {}): Promise<string> {
  const {
    subject = DANA.sub,
    email = DANA.email,
    emailVerified = true,
    displayName = DANA.displayName,
    preferredUsername = null,
    issuer = ISSUER,
    audience = AUDIENCE,
    azp,
    expiresInSeconds = 300,
    notBeforeSeconds,
    kid = l1.kid,
    extraClaims = {},
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = { ...extraClaims };
  if (email !== null) claims['email'] = email;
  if (emailVerified !== null) claims['email_verified'] = emailVerified;
  if (displayName !== null) claims['name'] = displayName;
  if (preferredUsername !== null) claims['preferred_username'] = preferredUsername;
  if (azp !== undefined) claims['azp'] = azp;

  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(subject)
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds);

  if (audience !== null) jwt = jwt.setAudience(audience);
  if (notBeforeSeconds !== undefined) jwt = jwt.setNotBefore(now + notBeforeSeconds);

  return jwt.sign(await key());
}

export async function bearerFor(person: Person, options: MintOptions = {}): Promise<string> {
  return `Bearer ${await mintToken({
    subject: person.sub,
    email: person.email,
    displayName: person.displayName,
    ...options,
  })}`;
}

/* ── The tokens section 1 asks for, which SignJWT will not produce ─────────── */

const b64u = (value: string | Uint8Array) =>
  Buffer.from(value as never)
    .toString('base64url')
    .replace(/=+$/, '');

/**
 * T-01: `alg: none`, signature segment empty.
 *
 * jose will not mint this and that is correct of it, so the harness assembles
 * the three segments by hand. The claims are otherwise a token the API would
 * accept, which is the whole point: the only thing wrong with it is that
 * nothing signed it.
 */
export function mintUnsignedToken(options: { subject?: string; email?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64u(
    JSON.stringify({
      sub: options.subject ?? DANA.sub,
      email: options.email ?? DANA.email,
      email_verified: true,
      name: DANA.displayName,
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 300,
    }),
  );
  return `${header}.${payload}.`;
}

/**
 * T-02: algorithm confusion — HS256, with the realm's PUBLIC key as the shared
 * secret. A verifier that picks its algorithm from the header rather than from
 * its own policy accepts this, because the "secret" is a published document.
 */
export async function mintAlgorithmConfusionToken(): Promise<string> {
  const publicKey = (await importJWK(l1.publicJwk as JWK, 'RS256')) as CryptoKey;
  const spki = await exportSPKI(publicKey);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: DANA.email,
    email_verified: true,
    name: DANA.displayName,
  })
    .setProtectedHeader({ alg: 'HS256', kid: l1.kid })
    .setSubject(DANA.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(spki));
}

/* ── supertest, carrying a token ───────────────────────────────────────────── */

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Agent = Record<Verb, (url: string) => Test>;

/**
 * The same wrapper the L0 suite uses, over a real token for a real person.
 *
 * A test that is ABOUT authentication does not use this: it calls
 * request(app) directly and sets the header it is making a point about.
 */
export function signedIn<T extends Agent>(agent: T, bearer: string): T {
  const verbs: Verb[] = ['get', 'post', 'put', 'patch', 'delete'];
  return Object.fromEntries(
    verbs.map((verb) => [verb, (url: string) => agent[verb](url).set('Authorization', bearer)]),
  ) as unknown as T;
}

export const schemaVersion = l1.schemaVersion;
export const publishedJwk = l1.publicJwk;
