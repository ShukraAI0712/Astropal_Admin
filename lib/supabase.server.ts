import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The server-side Supabase clients. SERVER ONLY - imported by route handlers
 * under `app/api` and nothing else.
 *
 * There are two ways to reach the analytics, and the app supports both so the
 * security posture is a deployment choice rather than a code change:
 *
 *   1. WITH a service-role key (stronger, and the default if one is set).
 *      The key bypasses row level security, so the route verifies the caller's
 *      JWT and their `app_role` itself before using it. With
 *      `admin_dashboard` revoked from `authenticated`, the analytics are then
 *      unreachable from any browser at all.
 *
 *   2. WITHOUT one (what runs when the env var is absent). The route forwards
 *      the signed-in admin's own token, and `public.admin_dashboard()` does
 *      the role check in the database. No secret to deploy, and one round trip
 *      instead of three - but a staff member's session on astropal.app can
 *      reach the RPC directly, which is the trade-off written up in
 *      sql/002_admin_dashboard_gate.sql and in ANALYTICS.md.
 *
 * Setting `SUPABASE_SERVICE_ROLE_KEY` moves from 2 to 1 with no code edit.
 *
 * Both clients are built lazily, on the first request rather than on import: a
 * missing variable should surface as a clear 500 from the one endpoint that
 * needs it, not as a failed build the moment anything collects page data
 * without secrets present.
 */

function url(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
  return value;
}

function anonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable.');
  return value;
}

/** True when the deployment has been given a service-role key. */
export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let service: SupabaseClient | null = null;

/** The privileged client. Only reachable when a service-role key is set. */
export function serviceClient(): SupabaseClient {
  if (service) return service;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  service = createClient(url(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return service;
}

/**
 * A client that acts as the signed-in admin.
 *
 * The anon key carries no privilege of its own - everything this client can do
 * comes from the caller's own token, which Postgres verifies and which
 * `admin_dashboard()` then checks the role of. Built per request because the
 * token is per request.
 */
export function userClient(token: string): SupabaseClient {
  return createClient(url(), anonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * A stable, non-reversible handle for one exact bearer token.
 *
 * This replaces an earlier `unverifiedSubject()` that keyed the role cache on
 * the `sub` claim of an UNVERIFIED JWT. That was a hole: `sub` is attacker
 * supplied, so anyone who learned a staff member's user id could mint an
 * unsigned token carrying it and be handed that staff member's cached role -
 * and with it a cached analytics document - without a signature ever being
 * checked. See the header of app/api/analytics/route.ts.
 *
 * A digest of the whole token does not have that problem. A cache entry can
 * only be reached by presenting, byte for byte, the same token that Postgres
 * already verified and authorised; change one character and the digest lands
 * on nothing and the request goes back to the database. The credential is
 * possession of the token, which is what it was all along.
 *
 * SHA-256 rather than the token itself so a heap dump or a log line of the
 * cache does not hand over live sessions.
 */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The `exp` claim, in milliseconds, without verifying the signature.
 *
 * Used only to REJECT early: an expired token is refused before any cache is
 * consulted, so a cached role can never outlive the session it was granted
 * for. Nothing is ever admitted on the strength of this - a forged `exp` in
 * the future buys the caller nothing, because the fingerprint above still has
 * to match an entry a real verification created.
 */
export function unverifiedExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
