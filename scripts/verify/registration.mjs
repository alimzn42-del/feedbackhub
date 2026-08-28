/**
 * L2 verification: a real token, from a real Keycloak, through the real seam.
 *
 * The suite mints its own tokens and mocks only the JWKS fetch, which is right
 * for 500 fast tests — but it means the one thing never exercised is a token
 * this application did not make: obtained by driving Keycloak's login form,
 * carrying Keycloak's own `sub`, verified against Keycloak's published keys.
 * The registration path in particular — "Create an account" → the provider's
 * page → back here → provisioned or refused — had never been run end to end.
 *
 * This script runs it, against the compose stack. It does four things and says
 * PASS or FAIL for each:
 *
 *   1. the "Create an account" button lands on a real registration form;
 *   2. a person Keycloak has just created (a completed registration: a new
 *      subject, email verified) is provisioned a local account on first call;
 *   3. under a domain-restricted policy, a person on the wrong domain
 *      authenticates successfully and is REFUSED an account, with a reason that
 *      names the rule and not the domains;
 *   4. and it puts the policy back.
 *
 * What it does NOT do is type into Keycloak's registration HTML — that form is
 * Keycloak's, and step 1 proves it renders. Steps 2 and 3 create the identity
 * through Keycloak's admin API, which leaves exactly the state a finished
 * registration leaves (a new user, `emailVerified: true`), and then obtain a
 * token the honest way: the authorization-code + PKCE flow, by posting the
 * login form. The token the API sees is indistinguishable from a real one
 * because it is one.
 *
 *   node scripts/verify/registration.mjs
 *
 * Environment (all defaulted for the compose stack):
 *   KC_BASE     http://localhost:8080
 *   API_BASE    http://localhost:4200/api      (the web tier proxies it)
 *   REALM       feedbackhub
 *   CLIENT_ID   feedbackhub-web
 *   REDIRECT_URI http://localhost:4200/auth/callback
 *   ADMIN_EMAIL / ADMIN_PASSWORD   a seeded admin, to write settings
 *   KC_ADMIN / KC_ADMIN_PASSWORD   the master-realm admin, to create users
 */
import { createHash, randomBytes } from 'node:crypto';

const KC_BASE = process.env.KC_BASE ?? 'http://localhost:8080';
const API_BASE = process.env.API_BASE ?? 'http://localhost:4200/api';
const REALM = process.env.REALM ?? 'feedbackhub';
const CLIENT_ID = process.env.CLIENT_ID ?? 'feedbackhub-web';
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'http://localhost:4200/auth/callback';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@feedbackhub.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'feedbackhub-dev';
const KC_ADMIN = process.env.KC_ADMIN ?? 'admin';
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD ?? 'admin';

const realmBase = `${KC_BASE}/realms/${REALM}/protocol/openid-connect`;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ── A cookie jar, because the login form needs the auth GET's cookies ──────── */
function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (response) => {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

/**
 * The authorization-code + PKCE flow, driven by posting the login form.
 *
 * Returns the access token, or throws with what Keycloak actually said — a
 * refused login, an unverified address, a redirect that carried an error
 * instead of a code — because a verification script that swallowed those would
 * be verifying nothing.
 */
async function tokenBySignIn(email, password, { page = 'auth' } = {}) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const jar = cookieJar();

  const authorize = new URL(`${realmBase}/${page}`);
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const page1 = await fetch(authorize, { redirect: 'manual' });
  jar.absorb(page1);
  const html = await page1.text();

  const action = html.match(/id="kc-form-login"[^>]*\baction="([^"]+)"/i)?.[1];
  if (!action) {
    throw new Error(`no login form at ${page} (status ${page1.status}) — is the realm reachable?`);
  }

  const submit = await fetch(action.replace(/&amp;/g, '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ username: email, password, credentialId: '' }).toString(),
  });

  const location = submit.headers.get('location');
  if (!location) {
    const why = (await submit.text()).match(/<span[^>]*kc-feedback-text[^>]*>([^<]+)</i)?.[1];
    throw new Error(`login did not redirect (status ${submit.status})${why ? `: ${why.trim()}` : ''}`);
  }

  const returned = new URL(location);
  const error = returned.searchParams.get('error');
  if (error) throw new Error(`Keycloak returned ${error}: ${returned.searchParams.get('error_description')}`);

  const code = returned.searchParams.get('code');
  if (!code) throw new Error(`redirect carried no code: ${location}`);

  const tokenResponse = await fetch(`${realmBase}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });

  const tokens = await tokenResponse.json();
  if (!tokens.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tokens)}`);
  return tokens.access_token;
}

/* ── The Keycloak admin API, for creating and removing the test identities ──── */
async function adminToken() {
  const response = await fetch(`${KC_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      username: KC_ADMIN,
      password: KC_ADMIN_PASSWORD,
      grant_type: 'password',
    }).toString(),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error('could not obtain a Keycloak admin token');
  return body.access_token;
}

async function createVerifiedUser(admin, { email, password }) {
  const response = await fetch(`${KC_BASE}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: email,
      email,
      emailVerified: true,
      enabled: true,
      firstName: 'New',
      lastName: 'Person',
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  if (response.status !== 201) {
    throw new Error(`could not create ${email}: ${response.status} ${await response.text()}`);
  }
}

async function deleteUser(admin, email) {
  const found = await fetch(
    `${KC_BASE}/admin/realms/${REALM}/users?exact=true&username=${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${admin}` } },
  ).then((r) => r.json());
  for (const user of found) {
    await fetch(`${KC_BASE}/admin/realms/${REALM}/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin}` },
    });
  }
}

async function api(path, token, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/* ── The checks ─────────────────────────────────────────────────────────────── */
let failures = 0;
function report(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function registrationFormRenders() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(`${realmBase}/registrations`);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: REDIRECT_URI,
    state: 'probe',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const html = await fetch(url, { redirect: 'manual' }).then((r) => r.text());
  const isRegistration = /kc-register-form|register|registration/i.test(html) && /password/i.test(html);
  report('the "Create an account" button lands on a real registration form', isRegistration);
}

async function main() {
  console.log(`\nL2 registration verification against ${KC_BASE} and ${API_BASE}\n`);

  const admin = await adminToken();
  const newcomer = { email: `newcomer.${Date.now()}@feedbackhub.local`, password: 'a-strong-password' };
  const outsider = { email: `outsider.${Date.now()}@example.com`, password: 'a-strong-password' };

  try {
    await registrationFormRenders();

    // 2. A completed registration on the board's own domain is provisioned.
    await createVerifiedUser(admin, newcomer);
    const newcomerToken = await tokenBySignIn(newcomer.email, newcomer.password);
    const provisioned = await api('/bootstrap', newcomerToken);
    report(
      'a newly registered person is provisioned a local account',
      provisioned.status === 200 && provisioned.body?.data?.user?.email === newcomer.email,
      `status ${provisioned.status}, email ${provisioned.body?.data?.user?.email ?? '—'}`,
    );

    // 3. Under a domain policy, an outsider authenticates and is refused, by rule.
    const adminToken_ = await tokenBySignIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    const set = await api('/settings', adminToken_, {
      method: 'PATCH',
      body: JSON.stringify({
        'registration.policy': 'domains',
        'registration.allowedDomains': ['feedbackhub.local'],
      }),
    });
    report('the registration policy can be set to domains', set.status === 200, `status ${set.status}`);

    await createVerifiedUser(admin, outsider);
    const outsiderToken = await tokenBySignIn(outsider.email, outsider.password);
    const refused = await api('/bootstrap', outsiderToken);
    const namesTheRule = /not open for registration|ask an admin/i.test(refused.body?.error?.message ?? '');
    const hidesTheDomains = !/(feedbackhub\.local|example\.com)/.test(refused.body?.error?.message ?? '');
    report(
      'an outsider authenticates but is refused an account, 403',
      refused.status === 403,
      `status ${refused.status}`,
    );
    report(
      'the refusal names the rule and not the allowed domains',
      namesTheRule && hidesTheDomains,
      refused.body?.error?.message,
    );
  } finally {
    // 4. Put the board back the way it was, whatever happened above.
    try {
      const adminToken_ = await tokenBySignIn(ADMIN_EMAIL, ADMIN_PASSWORD);
      const reset = await api('/settings', adminToken_, {
        method: 'PATCH',
        body: JSON.stringify({ 'registration.policy': 'open', 'registration.allowedDomains': null }),
      });
      report('the registration policy is put back to open', reset.status === 200, `status ${reset.status}`);
    } catch (error) {
      report('the registration policy is put back to open', false, String(error));
    }
    await deleteUser(admin, newcomer.email);
    await deleteUser(admin, outsider.email);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nverification could not run: ${error.message}\n`);
  process.exit(2);
});
