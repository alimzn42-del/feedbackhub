/* ════════════════════════════════════════════════════════════════════════════
 *                                    PKCE
 *
 * The authorization code flow, made safe for a client that cannot keep a
 * secret.
 *
 * The problem it solves: this application is a public client. It has no client
 * secret — there is nowhere in a browser to put one — so an authorization code
 * intercepted on its way back is, on its own, enough to obtain tokens. PKCE
 * closes that: the browser invents a one-time secret before it starts, sends
 * only a hash of it to the provider, and presents the original when it redeems
 * the code. An intercepted code without the verifier is worth nothing.
 *
 * S256 and not `plain`. The realm requires it, and `plain` sends the verifier
 * itself in the first redirect, which is the thing being protected.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * base64url, which is what every value in this flow is encoded as: base64 with
 * the two URL-hostile characters swapped and the padding dropped.
 */
function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A high-entropy random string.
 *
 * Used for the code verifier, and for the `state` and `nonce` that go with it.
 * 32 bytes is comfortably inside the 43–128 character range the specification
 * allows for a verifier once encoded.
 */
export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The SHA-256 of the verifier, which is all the provider is ever shown. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}
