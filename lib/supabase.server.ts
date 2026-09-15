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
 * The `sub` claim of a JWT, without verifying it.
 *
 * Used ONLY as a cache key, so that two admins do not read each other's
 * cached role. Nothing is authorised on the strength of this - Postgres
 * verifies the signature and `admin_dashboard()` decides what the caller may
 * see, so a forged token buys a wrong cache bucket and nothing else.
 */
export function unverifiedSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const sub = JSON.parse(json)?.sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}
