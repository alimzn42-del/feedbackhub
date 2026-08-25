import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';

/* ════════════════════════════════════════════════════════════════════════════
 *                        MINTING TOKENS FOR THE TEST SUITE
 *
 * The suite needs a valid token for every request, and it must not need a
 * running Keycloak to get one. Standing a container up would make 220 fast
 * tests slow, dependent on a network, and able to fail for reasons that have
 * nothing to do with the code under test — which is the opposite of what the
 * suite is for.
 *
 * So the tests own a signing key and mint their own tokens. What they do NOT
 * do is skip verification: the application checks these tokens through its real
 * path. The signature is genuinely verified, `iss` and `aud` are genuinely
 * compared, `exp` genuinely expires, and the `kid` in the header genuinely has
 * to match a key in the set. The only thing replaced is the network fetch in
 * src/auth/jwks.ts — and fetch is not the part anybody doubts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CANNOT REACH PRODUCTION
 *
 * It is not compiled. tsconfig.build.json excludes `src/**\/*.test-support.ts`
 * alongside the test files themselves, so the code that signs tokens is absent
 * from dist/ rather than present and guarded. There is no environment variable
 * that switches it on, no identity mode it corresponds to, and nothing in the
 * application imports it — the only importers are *.test.ts files, which are
 * not compiled either.
 *
 * Absent beats guarded. A guard is a runtime claim about a code path that
 * exists; this is the code path not existing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The realm this pretends to be is whatever the test environment declares in
 * vitest.config.ts, read from the environment rather than repeated here — so
 * the issuer these tokens claim and the issuer the application insists on
 * cannot drift apart and quietly stop testing anything.
 */

export const TEST_ISSUER = process.env.OIDC_ISSUER_URL as string;
export const TEST_AUDIENCE = process.env.OIDC_AUDIENCE as string;

/** The key the published set contains. A token signed with anything else fails. */
const SIGNING_KID = 'feedbackhub-test-key';

/** A second, unpublished key. Used to produce a signature nothing can verify. */
const FOREIGN_KID = 'not-in-the-published-set';

const published = await generateKeyPair('RS256', { extractable: true });
const foreign = await generateKeyPair('RS256', { extractable: true });

async function asJwk(key: CryptoKey, kid: string): Promise<JWK> {
  return { ...(await exportJWK(key)), kid, alg: 'RS256', use: 'sig' };
}

/**
 * Stands in for what createRemoteJWKSet would have fetched.
 *
 * createLocalJWKSet is jose's own resolver over a key set, so `kid` selection,
 * algorithm matching and "no key matches" are the real implementations rather
 * than a stub that hands back whatever it is given.
 */
export const testVerificationKeys = createLocalJWKSet({
  keys: [await asJwk(published.publicKey, SIGNING_KID)],
});

export interface MintOptions {
  /** The `sub`. Everything about identity hangs off this. */
  subject?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string | null;
  issuer?: string;
  audience?: string;
  /** Seconds from now. Negative mints a token that has already expired. */
  expiresInSeconds?: number;
  /** Sign with the key that is not in the published set. */
  signedByAStranger?: boolean;
  /** Claim a `kid` the published set does not contain. */
  unknownKeyId?: boolean;
}

/**
 * The subject every test signs in as by default.
 *
 * Which PERSON that subject resolves to is still decided by the mocked users
 * repository, exactly as it was when the seam read an email out of the
 * environment. A test that wants to be an admin still says so by changing what
 * the repository returns, not by minting a different token — the token has
 * never carried a role and does not carry one now.
 */
export const TEST_SUBJECT = '11111111-1111-4111-8111-111111111111';

export async function mintToken(options: MintOptions = {}): Promise<string> {
  const {
    subject = TEST_SUBJECT,
    email = 'dana@feedbackhub.local',
    emailVerified = true,
    displayName = 'Dana Okafor',
    issuer = TEST_ISSUER,
    audience = TEST_AUDIENCE,
    expiresInSeconds = 300,
    signedByAStranger = false,
    unknownKeyId = false,
  } = options;

  const now = Math.floor(Date.now() / 1000);
  const key = signedByAStranger ? foreign.privateKey : published.privateKey;
  const kid = signedByAStranger || unknownKeyId ? FOREIGN_KID : SIGNING_KID;

  const jwt = new SignJWT({
    email,
    email_verified: emailVerified,
    ...(displayName === null ? {} : { name: displayName }),
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds);

  return jwt.sign(key);
}

/**
 * A ready-to-use header value, awaited once at module load.
 *
 * Almost every test wants "a token that works" and cares about nothing else,
 * and making each of them await a mint would put an async step in front of
 * assertions that have nothing to do with authentication.
 */
export const VALID_BEARER = `Bearer ${await mintToken()}`;

/**
 * A bearer header for one particular person.
 *
 * Almost no test needs this: which person a request acts as is decided by what
 * the mocked users repository returns for the subject, exactly as it was
 * decided by what it returned for an email before authentication existed. This
 * is for the handful of tests that assert on the acting person's own address —
 * where a token describing somebody else would set the reconciliation path off
 * and make the test about that instead.
 */
export async function bearerFor(person: { email: string; displayName: string }): Promise<string> {
  return `Bearer ${await mintToken({ email: person.email, displayName: person.displayName })}`;
}

/**
 * supertest, carrying a token.
 *
 * Every route-level test in this suite goes through here, and the wrapper
 * exists so that adding authentication to 173 existing call sites was one
 * mechanical substitution — `request(app)` became `signedIn(request(app))` and
 * nothing else about those tests changed. What each test asserts, and which
 * person it acts as, is exactly what it was before.
 *
 * A test that is ABOUT authentication does not use this. It calls
 * `request(app)` directly and sets whatever header it is making a point about,
 * which is what keeps "no token" and "a token this API will not accept"
 * writable at all.
 */
type SupertestVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';
type SupertestAgent = Record<
  SupertestVerb,
  (url: string) => { set(field: string, value: string): unknown }
>;

export function signedIn<T extends SupertestAgent>(agent: T, bearer = VALID_BEARER): T {
  const verbs: SupertestVerb[] = ['get', 'post', 'put', 'patch', 'delete'];

  return Object.fromEntries(
    verbs.map((verb) => [verb, (url: string) => agent[verb](url).set('Authorization', bearer)]),
  ) as unknown as T;
}
