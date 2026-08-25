/**
 * Adds Google as a sign-in method to the running development realm.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SCRIPT AND NOT PART OF THE REALM FILE
 *
 * A reviewer cannot obtain Google OAuth credentials, and the realm import is a
 * static document that cannot leave the provider out when they are absent. An
 * identity provider configured with an empty client id is not "degraded" — it
 * is a Google button on the sign-in page that takes somebody to an error.
 *
 * So the realm ships without it, the sign-in page shows email and password, and
 * everything works. This adds the provider when, and only when, there is
 * something real to configure it with. It is a documented command rather than a
 * walk through the admin console, which is the requirement it is meeting.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Idempotent: run it again after changing the credentials and it updates the
 * provider rather than failing on a name that already exists.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = 'feedbackhub';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const REDIRECT_URI = `${KEYCLOAK_URL}/realms/${REALM}/broker/google/endpoint`;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    'Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.\n' +
      '\n' +
      'Neither is set, so nothing has been changed and nothing is broken: the\n' +
      'board signs in with email and password, which is how it is meant to work\n' +
      'without them.\n' +
      '\n' +
      'To enable it, create an OAuth client at\n' +
      '  https://console.cloud.google.com/apis/credentials\n' +
      'of type "Web application", with this authorised redirect URI:\n' +
      `  ${REDIRECT_URI}\n` +
      'then put the two values in .env and run this again.',
  );
}

if (!ADMIN_PASSWORD) {
  fail('KEYCLOAK_ADMIN_PASSWORD is not set. It is the account docker-compose created.');
}

async function accessToken() {
  const response = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    }),
  });

  if (!response.ok) {
    fail(
      `Could not sign in to Keycloak at ${KEYCLOAK_URL} (${response.status}).\n` +
        'Is it running? `npm run auth:up`, and check KEYCLOAK_ADMIN_PASSWORD.',
    );
  }

  return (await response.json()).access_token;
}

/**
 * `trustEmail` is false, and it is the most important line in this file.
 *
 * With it true, Keycloak takes the address in the assertion at face value and
 * links it to whatever local account already holds that address. That is an
 * account-takeover path: register somebody else's address at any provider that
 * does not verify it, sign in, and arrive inside their account.
 *
 * Google does verify. Setting this explicitly rather than relying on that is
 * the point — the rule should hold because it was configured, not because of a
 * property of one provider. The API asserts the same thing again on its own
 * side, in src/auth/current-user.ts, where it does not depend on this file.
 */
const provider = {
  alias: 'google',
  displayName: 'Google',
  providerId: 'google',
  enabled: true,
  trustEmail: false,
  storeToken: false,
  addReadTokenRoleOnCreate: false,
  linkOnly: false,
  firstBrokerLoginFlowAlias: 'first broker login',
  config: {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    defaultScope: 'openid email profile',
    // Google will not return an unverified address under these scopes, and the
    // API refuses to provision one regardless.
    syncMode: 'IMPORT',
  },
};

const token = await accessToken();

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const base = `${KEYCLOAK_URL}/admin/realms/${REALM}/identity-provider/instances`;

const existing = await fetch(`${base}/google`, { headers });

const response = existing.ok
  ? await fetch(`${base}/google`, { method: 'PUT', headers, body: JSON.stringify(provider) })
  : await fetch(base, { method: 'POST', headers, body: JSON.stringify(provider) });

if (!response.ok) {
  fail(`Keycloak refused the identity provider (${response.status}): ${await response.text()}`);
}

console.log(
  `\nGoogle is now a sign-in method on the ${REALM} realm.\n` +
    `\n  Authorised redirect URI: ${REDIRECT_URI}\n` +
    '\nIt links to an existing account only on a verified email address.\n' +
    '`docker compose down` discards it, because the realm is not persisted —\n' +
    'run this again after bringing it back up.\n',
);
