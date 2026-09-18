import { NextResponse } from 'next/server';
import {
  hasServiceKey, serviceClient, tokenFingerprint, unverifiedExpiry, userClient,
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
 *
 * WHAT THE CACHES MAY AND MAY NOT DECIDE
 *
 * This document holds customer emails and revenue, so the caches in here are
 * part of the security boundary and are written under two rules:
 *
 *   1. A cache may only ever SKIP WORK that has already been authorised. It
 *      may never be the thing that authorises. The role cache is therefore
 *      keyed on a digest of the exact bearer token that a prior request had
 *      verified - not on any claim read out of the token, because claims are
 *      caller-supplied until a signature says otherwise.
 *   2. A caller may not choose a cache key. `tz` is validated against the IANA
 *      database and both maps are bounded, so a request cannot grow the
 *      process's memory or force an unbounded number of aggregation queries.
 */

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const ROLE_TTL_MS = 60_000;

/**
 * Bounds on the two maps. Module scope outlives the request, so anything a
 * caller can add to it needs a ceiling, or a warm instance is a slow memory
 * leak with a query attached.
 */
const MAX_DOCUMENTS = 24;
const MAX_ROLES = 512;

/**
 * The floor under `?fresh=1`.
 *
 * `fresh` skips the cache, so without a floor every request carrying it is
 * one 400-day aggregation - and the parameter is reachable by anything
 * holding a staff session, which sql/002_admin_dashboard_gate.sql already
 * warns includes script running in a staff member's browser. A held-down
 * Refresh key, or a loop, was a way to point the production database at
 * itself.
 *
 * Five seconds is below the threshold at which a person clicking Refresh
 * notices anything, and it caps the endpoint at twelve of those queries a
 * minute per instance instead of as many as the network will carry.
 */
const FRESH_FLOOR_MS = 5_000;

const DEFAULT_TZ = 'Asia/Kolkata';

/** Roles the backend lets into the admin surface. Mirrors `require_staff`. */
const STAFF_ROLES = new Set(['staff', 'admin', 'super_admin']);

type CacheEntry = { at: number; document: Record<string, unknown> };
type RoleEntry = { at: number; role: string };

/**
 * The document is cached WITHOUT `caller_role`, and each caller's own role is
 * cached separately against a digest of their token. Two admins sharing one
 * cached document must not end up sharing one cached role - that is how a
 * staff member would be shown an admin's controls.
 */
const documentCache = new Map<string, CacheEntry>();
const roleCache = new Map<string, RoleEntry>();

/**
 * Insert, dropping whatever expired and then the oldest entry if still over
 * the ceiling. Map iterates in insertion order, so `keys().next()` is the
 * oldest key and re-setting an existing key keeps its original position -
 * close enough to an LRU for two maps this small, without the machinery.
 */
function remember<T extends { at: number }>(
  map: Map<string, T>, key: string, value: T, max: number, ttl: number,
) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.at >= ttl) map.delete(k);
  }
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** A cache entry, or null when there is none or it has aged out. */
function fresh<T extends { at: number }>(map: Map<string, T>, key: string, ttl: number): T | null {
  const hit = map.get(key);
  if (!hit || Date.now() - hit.at >= ttl) return null;
  return hit;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * The requested timezone, or null if it is not a real one.
 *
 * `tz` reaches both a cache key and `now() at time zone p_tz` in Postgres, so
 * it is validated rather than trusted: an unchecked value lets a caller mint
 * unlimited distinct cache keys - each miss being one 400-day aggregation -
 * and lets a malformed name surface as a raw database error. `Intl` answers
 * from the same IANA database Postgres ships, which caps the key space at the
 * few hundred names that actually exist.
 */
function timeZone(raw: string | null): string | null {
  if (raw === null || raw === '') return DEFAULT_TZ;
  if (raw.length > 64 || !/^[A-Za-z0-9+_/-]+$/.test(raw)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

function split(document: Record<string, unknown>) {
  const { caller_role, ...rest } = document as { caller_role?: string };
  return { role: typeof caller_role === 'string' ? caller_role : null, rest };
}

/**
 * Every response from this route, with the headers a document full of
 * customer emails should carry: no intermediary, and no browser cache on
 * disk, gets to keep a copy of it.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
    },
  });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    // A missing or malformed environment variable lands here. Log the detail
    // where operators can read it; the browser gets a fixed sentence, because
    // the messages thrown in here name environment variables and, from the
    // Postgres client, internal schema.
    console.error('[api/analytics] request failed', e);
    return json({ error: 'Analytics is unavailable.' }, 500);
  }
}

async function handle(request: Request) {
  const token = bearer(request);
  if (!token) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  // Refuse an expired token before any cache is consulted, so no cached role
  // can outlive the session it was granted for. This reads the token without
  // verifying it, which is safe in this direction only: it can turn a request
  // away, never let one in.
  const expiry = unverifiedExpiry(token);
  if (expiry !== null && expiry <= Date.now()) {
    return json({ error: 'Session has expired.' }, 401);
  }

  const url = new URL(request.url);
  const tz = timeZone(url.searchParams.get('tz'));
  if (!tz) {
    return json({ error: 'Unknown timezone.' }, 400);
  }
  // A forced refresh is honoured only once the current document has had time
  // to be worth replacing; below that it is answered from cache like any
  // other read. See FRESH_FLOOR_MS.
  const forced = url.searchParams.get('fresh') === '1'
    && !fresh(documentCache, tz, FRESH_FLOOR_MS);

  // --- The privileged path: this route is the gate ------------------------
  if (hasServiceKey()) {
    const admin = serviceClient();

    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) {
      return json({ error: 'Session is not valid.' }, 401);
    }

    const cachedRole = fresh(roleCache, auth.user.id, ROLE_TTL_MS);
    let role: string;

    if (cachedRole) {
      role = cachedRole.role;
    } else {
      const { data: profile, error: profileError } = await admin
        .from('user_profiles')
        .select('app_role')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      // A failed lookup is not an absent role. Defaulting to 'user' on an
      // outage would lock every admin out, and defaulting the other way would
      // let anyone in during one; say so instead.
      if (profileError) {
        console.error('[api/analytics] role lookup failed', profileError);
        return json({ error: 'Could not verify your access.' }, 503);
      }
      role = profile?.app_role ?? 'user';
      remember(roleCache, auth.user.id, { at: Date.now(), role }, MAX_ROLES, ROLE_TTL_MS);
    }

    if (!STAFF_ROLES.has(role)) {
      return json({ error: 'Your account does not have admin access.' }, 403);
    }

    const hit = forced ? null : fresh(documentCache, tz, CACHE_TTL_MS);
    if (hit) {
      return json({
        ...hit.document,
        caller_role: role,
        cached: true,
        cache_age_seconds: Math.round((Date.now() - hit.at) / 1000),
      });
    }

    const { data, error } = await admin.rpc('admin_dashboard', { p_tz: tz });
    if (error) return stale(error, tz, role);

    const { rest } = split(data as Record<string, unknown>);
    remember(documentCache, tz, { at: Date.now(), document: rest }, MAX_DOCUMENTS, CACHE_TTL_MS);

    return json({ ...rest, caller_role: role, cached: false, cache_age_seconds: 0 });
  }

  // --- The forwarded-token path: the database is the gate -----------------
  //
  // The cache key is a digest of the whole token, so reaching a cached role
  // means presenting the exact token a previous request had Postgres verify.
  // Keying this on the token's `sub` claim instead - which is what this used
  // to do - meant an unsigned JWT naming a known staff user id was served a
  // cached document, with no signature checked anywhere on the path.
  const fingerprint = tokenFingerprint(token);
  const cachedRole = fresh(roleCache, fingerprint, ROLE_TTL_MS);
  const knownRole = cachedRole?.role ?? null;
  const hit = forced ? null : fresh(documentCache, tz, CACHE_TTL_MS);

  // A cache hit is only usable when this caller's own role is also known.
  // Otherwise fall through and let the database answer both questions at once.
  if (hit && knownRole) {
    return json({
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
      return json({ error: 'Your account does not have admin access.' }, 403);
    }
    // A rejected or expired JWT arrives as a PostgREST 401 rather than a
    // Postgres error code. Serving a stale document to it would be handing
    // data to a caller who just failed authentication.
    if (error.code === 'PGRST301' || /jwt/i.test(error.message)) {
      return json({ error: 'Session is not valid.' }, 401);
    }
    return stale(error, tz, knownRole);
  }

  const { role, rest } = split(data as Record<string, unknown>);
  remember(documentCache, tz, { at: Date.now(), document: rest }, MAX_DOCUMENTS, CACHE_TTL_MS);
  if (role) remember(roleCache, fingerprint, { at: Date.now(), role }, MAX_ROLES, ROLE_TTL_MS);

  return json({
    ...rest,
    caller_role: role ?? 'staff',
    cached: false,
    cache_age_seconds: 0,
  });
}

/**
 * A stale document beats an error screen: the numbers are a few minutes old
 * rather than absent, and the page says so.
 *
 * Only ever reached for a caller whose role is already established, and the
 * database's own words stay in the log rather than going to the browser -
 * Postgres errors name functions, columns and search paths.
 */
function stale(error: { message: string }, tz: string, role: string | null) {
  console.error('[api/analytics] admin_dashboard failed', error);
  const hit = documentCache.get(tz);
  if (hit && role) {
    return json({
      ...hit.document,
      caller_role: role,
      cached: true,
      stale: true,
      cache_age_seconds: Math.round((Date.now() - hit.at) / 1000),
    });
  }
  return json({ error: 'Analytics is unavailable.' }, 500);
}
