import { NextResponse } from 'next/server';
import {
  hasServiceKey, serviceClient, unverifiedSubject, userClient,
} from '@/lib/supabase.server';

/**
 * GET /api/analytics
 *
 * The dashboard's only data endpoint. It returns the whole document that
 * `public.admin_dashboard()` produces - every panel on every screen - so the
 * browser makes one request per visit rather than one per panel.
 *
 * Cost, which is the reason this file is shaped the way it is:
 *
 *   * ONE database call per cache miss. All the aggregation happens
 *     server-side in a single round trip.
 *   * The document is cached in module scope for CACHE_TTL_MS. Refreshing,
 *     switching between the six screens, or leaving the dashboard open costs
 *     nothing until the window expires. `?fresh=1` skips it, and that is what
 *     the Refresh button sends.
 *
 * Module scope is per serverless instance, which is the right scope here: a
 * cold instance pays one query, a warm one pays none, and nothing needs
 * invalidating because the data is a rolling window rather than a fact about
 * one row.
 *
 * TWO WAYS IN, and which one runs is a deployment choice:
 *
 *   * `SUPABASE_SERVICE_ROLE_KEY` set - this route checks the caller's JWT and
 *     `app_role` itself, then queries with the service key. With
 *     `admin_dashboard` revoked from `authenticated`, the analytics are
 *     unreachable from any browser. Stronger, and preferred.
 *   * No key - the caller's own token is forwarded and the database does the
 *     role check inside `admin_dashboard()`. No secret to deploy and one round
 *     trip instead of three. See sql/002_admin_dashboard_gate.sql for the
 *     exposure this accepts.
 *
 * Adding the env var moves between them with no code change.
 */

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const ROLE_TTL_MS = 60_000;

/** Roles the backend lets into the admin surface. Mirrors `require_staff`. */
const STAFF_ROLES = new Set(['staff', 'admin', 'super_admin']);

type CacheEntry = { at: number; document: Record<string, unknown> };
type RoleEntry = { at: number; role: string };

/**
 * The document is cached WITHOUT `caller_role`, and each caller's own role is
 * cached separately against their user id. Two admins sharing one cached
 * document must not end up sharing one cached role - that is how a staff
 * member would be shown an admin's controls.
 */
const documentCache = new Map<string, CacheEntry>();
const roleCache = new Map<string, RoleEntry>();

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function split(document: Record<string, unknown>) {
  const { caller_role, ...rest } = document as { caller_role?: string };
  return { role: typeof caller_role === 'string' ? caller_role : null, rest };
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    // A missing or malformed environment variable lands here. Say so plainly
    // rather than leaking a stack trace into the dashboard's error panel.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Analytics is unavailable.' },
      { status: 500 }
    );
  }
}

async function handle(request: Request) {
  const token = bearer(request);
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const tz = url.searchParams.get('tz') || 'Asia/Kolkata';
  const fresh = url.searchParams.get('fresh') === '1';
  const subject = unverifiedSubject(token);

  // --- The privileged path: this route is the gate ------------------------
  if (hasServiceKey()) {
    const admin = serviceClient();

    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) {
      return NextResponse.json({ error: 'Session is not valid.' }, { status: 401 });
    }

    const cachedRole = roleCache.get(auth.user.id);
    let role: string;

    if (cachedRole && Date.now() - cachedRole.at < ROLE_TTL_MS) {
      role = cachedRole.role;
    } else {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('app_role')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      role = profile?.app_role ?? 'user';
      roleCache.set(auth.user.id, { at: Date.now(), role });
    }

    if (!STAFF_ROLES.has(role)) {
      return NextResponse.json(
        { error: 'Your account does not have admin access.' },
        { status: 403 }
      );
    }

    const hit = documentCache.get(tz);
    if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({
        ...hit.document,
        caller_role: role,
        cached: true,
        cache_age_seconds: Math.round((Date.now() - hit.at) / 1000),
      });
    }

    const { data, error } = await admin.rpc('admin_dashboard', { p_tz: tz });
    if (error) return stale(error, tz, role);

    const { rest } = split(data as Record<string, unknown>);
    documentCache.set(tz, { at: Date.now(), document: rest });

    return NextResponse.json({ ...rest, caller_role: role, cached: false, cache_age_seconds: 0 });
  }

  // --- The forwarded-token path: the database is the gate -----------------
  const hit = documentCache.get(tz);
  const cachedRole = subject ? roleCache.get(subject) : undefined;
  const knownRole =
    cachedRole && Date.now() - cachedRole.at < ROLE_TTL_MS ? cachedRole.role : null;

  // A cache hit is only usable when this caller's own role is also known.
  // Otherwise fall through and let the database answer both questions at once.
  if (!fresh && hit && knownRole && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({
      ...hit.document,
      caller_role: knownRole,
      cached: true,
      cache_age_seconds: Math.round((Date.now() - hit.at) / 1000),
    });
  }

  const { data, error } = await userClient(token).rpc('admin_dashboard', { p_tz: tz });

  if (error) {
    // 42501 is the insufficient_privilege that admin_dashboard() raises for a
    // caller who is not staff. Anything else is a real failure.
    if (error.code === '42501' || /not permitted|not authenticated/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Your account does not have admin access.' },
        { status: 403 }
      );
    }
    return stale(error, tz, knownRole);
  }

  const { role, rest } = split(data as Record<string, unknown>);
  documentCache.set(tz, { at: Date.now(), document: rest });
  if (subject && role) roleCache.set(subject, { at: Date.now(), role });

  return NextResponse.json({
    ...rest,
    caller_role: role ?? 'staff',
    cached: false,
    cache_age_seconds: 0,
  });
}

/**
 * A stale document beats an error screen: the numbers are a few minutes old
 * rather than absent, and the page says so.
 */
function stale(error: { message: string }, tz: string, role: string | null) {
  const hit = documentCache.get(tz);
  if (hit && role) {
    return NextResponse.json({
      ...hit.document,
      caller_role: role,
      cached: true,
      stale: true,
      cache_age_seconds: Math.round((Date.now() - hit.at) / 1000),
    });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
