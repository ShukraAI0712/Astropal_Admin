import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase.admin';

/**
 * GET /api/analytics
 *
 * The dashboard's only data endpoint. It returns the whole document that
 * `public.admin_analytics()` produces - every panel on every screen - so the
 * browser makes one request per visit rather than one per panel.
 *
 * Cost, which is the reason this file is shaped the way it is:
 *
 *   * ONE database call per cache miss. The analytics function does all the
 *     aggregation server-side in a single round trip.
 *   * The result is cached in module scope for CACHE_TTL_MS. Refreshing the
 *     page, switching between the six screens, or leaving the dashboard open
 *     costs nothing until the window expires. `?fresh=1` skips the cache, and
 *     that is what the Refresh button sends.
 *   * The caller's role is cached the same way and keyed by user id, so a
 *     hard refresh does not re-read `user_profiles` either.
 *
 * Module scope is per serverless instance, which is exactly the right scope
 * here: a cold instance pays one query, a warm one pays none, and nothing has
 * to be invalidated because the data is a rolling window rather than a fact
 * about one row.
 */

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const ROLE_TTL_MS = 60_000;

/** Roles the backend lets into the admin surface. Mirrors `require_staff`. */
const STAFF_ROLES = new Set(['staff', 'admin', 'super_admin']);

type CacheEntry = { at: number; payload: unknown };
type RoleEntry = { at: number; role: string };

const analyticsCache = new Map<string, CacheEntry>();
const roleCache = new Map<string, RoleEntry>();

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

async function callerRole(token: string): Promise<{ role: string; userId: string } | null> {
  const supabaseAdmin = getSupabaseAdmin();

  // Verifying the JWT is the one thing that cannot be cached by token alone
  // without holding tokens in memory, so it happens on every request. It is a
  // single Auth call and no database read.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  const userId = data.user.id;
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) {
    return { role: cached.role, userId };
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('app_role')
    .eq('user_id', userId)
    .maybeSingle();

  const role = profile?.app_role ?? 'user';
  roleCache.set(userId, { at: Date.now(), role });
  return { role, userId };
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    // A missing service-role key lands here. Say so plainly rather than
    // leaking a stack trace into the dashboard's error panel.
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

  const caller = await callerRole(token);
  if (!caller) {
    return NextResponse.json({ error: 'Session is not valid.' }, { status: 401 });
  }

  if (!STAFF_ROLES.has(caller.role)) {
    return NextResponse.json(
      { error: 'Your account does not have admin access.' },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const tz = url.searchParams.get('tz') || 'Asia/Kolkata';
  const fresh = url.searchParams.get('fresh') === '1';

  const cached = analyticsCache.get(tz);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({
      ...(cached.payload as object),
      caller_role: caller.role,
      cached: true,
      cache_age_seconds: Math.round((Date.now() - cached.at) / 1000),
    });
  }

  const { data, error } = await getSupabaseAdmin().rpc('admin_analytics', { p_tz: tz });

  if (error) {
    // A stale document beats an error screen: the numbers are a few minutes
    // old rather than absent, and the page says so.
    if (cached) {
      return NextResponse.json({
        ...(cached.payload as object),
        caller_role: caller.role,
        cached: true,
        stale: true,
        cache_age_seconds: Math.round((Date.now() - cached.at) / 1000),
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  analyticsCache.set(tz, { at: Date.now(), payload: data });

  return NextResponse.json({
    ...(data as object),
    caller_role: caller.role,
    cached: false,
    cache_age_seconds: 0,
  });
}
