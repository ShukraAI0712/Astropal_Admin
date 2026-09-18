# Security notes

A record of what this app's security boundary actually is, what was found
wrong with it in the audit of 2026-09-18, and what is knowingly left open.

The thing worth holding on to: this dashboard's single endpoint returns
customer emails, revenue and per-user activity in one document. Everything
below is about who gets to read that document.

---

## Fixed

### 1. Authentication bypass through the role cache — critical

`app/api/analytics/route.ts`, the forwarded-token posture (no
`SUPABASE_SERVICE_ROLE_KEY` set).

The route cached each caller's role against the `sub` claim of their JWT,
read with `unverifiedSubject()` — a base64 decode, no signature check. The
comment said nothing was authorised on the strength of it. Something was:

```
cachedRole = roleCache.get(subject)      // key from an unverified claim
if (!fresh && hit && knownRole && ...)   // -> serve the cached document
    return NextResponse.json({ ...hit.document, caller_role: knownRole })
```

On that branch no signature was verified anywhere, by this route or by
Postgres. Anyone who learned a staff member's user id — it is a UUID, but
one that travels through the product, its logs and its support tooling —
could assemble an unsigned JWT carrying it, send it while any staff member's
own traffic kept the two caches warm, and be handed the whole analytics
document with a 200.

**Fixed** by keying the role cache on `tokenFingerprint()`, a SHA-256 of the
entire bearer token. A cache entry is now reachable only by presenting, byte
for byte, the token that a previous request had Postgres verify and
authorise; anything else misses and goes to the database, which rejects it.
The credential is possession of the token, which is what it was supposed to
be. `unverifiedSubject()` is gone.

Two supporting changes on the same path:

- An expired token is now refused (`unverifiedExpiry()`) **before** any cache
  is read, so a cached role cannot outlive the session it was granted for.
  Reading an unverified claim is safe in that direction only: it can turn a
  request away, never let one in.
- A PostgREST `PGRST301` / JWT error now returns 401 instead of falling
  through to `stale()`, which would have served a cached document to a caller
  who had just failed authentication.

The service-role posture was never exposed this way — it calls
`auth.getUser(token)` first — and is unchanged in substance.

### 2. Caller-chosen cache keys — high

`tz` came straight off the query string into a `Map` key and into
`now() at time zone p_tz`. Two problems: the two module-scope maps grew
without a ceiling for the life of a warm instance, and every novel `tz`
was a cache miss, which is one 400-day aggregation over the product's whole
history.

**Fixed**: `tz` is validated against the IANA database via `Intl`, with a
length and character bound in front of it, so the key space is the few
hundred names that exist. Both maps are now bounded (`MAX_DOCUMENTS`,
`MAX_ROLES`) and prune expired entries on write.

### 3. `?fresh=1` as a database amplifier — high

`fresh=1` skips the cache, so each request carrying it cost one full
aggregation, at whatever rate the caller could send. `sql/002` already notes
that a staff member's browser is inside this threat model.

**Fixed**: a forced refresh is honoured only when the cached document is
older than `FRESH_FLOOR_MS` (5s) — invisible to someone clicking Refresh,
and a ceiling of twelve such queries a minute rather than none.

### 4. Internal error text returned to the browser — medium

The catch-all returned `e.message`, and `stale()` returned the Postgres
error verbatim. Those messages name environment variables, functions,
columns and search paths.

**Fixed**: detail goes to `console.error` for operators, the browser gets a
fixed sentence. Relatedly, a failed `user_profiles` lookup in the
service-role path now returns 503 rather than silently reading as the role
`user` — an outage should not be indistinguishable from a demotion.

### 5. No response-cache headers on the analytics document — medium

`dynamic = 'force-dynamic'` governs Next's own cache, not anyone else's. The
document now goes out with `Cache-Control: no-store, no-cache,
must-revalidate, private`, so no proxy or disk cache keeps a copy of a
customer list.

### 6. No Content-Security-Policy, and no security headers at all — medium

An admin console holding a Supabase session in local storage had nothing
standing between an injected script and both the data on screen and the
token that fetches more of it.

**Fixed**: `proxy.ts` (Next 16's renamed `middleware`) mints a per-request
nonce and sets a strict CSP; `next.config.ts` adds the static headers.

`connect-src` is the directive doing the real work — `'self'`, Supabase and
the product API are the complete set of origins this app talks to, read from
the same public env vars the client is built with so the policy cannot drift
from the code. Exfiltration to anywhere else is refused by the browser.

`style-src-attr 'unsafe-inline'` stays open because the charts and status
dots are built from `style={{ ... }}` attributes and a nonce cannot attach to
an attribute. It is the cheap one to leave open: a style attribute executes
nothing, and the CSS-as-exfiltration trick needs an outbound request that
`img-src` and `connect-src` already refuse.

Also set: `X-Frame-Options: DENY` with `frame-ancestors 'none'`, HSTS,
`nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, and `poweredByHeader: false`.

Nonces require dynamic rendering. Nothing was lost — every screen is already
a client component behind an auth gate that fetches on mount.

### 7. `admin_dashboard()` failed open on missing JWT claims — medium

`sql/002_admin_dashboard_gate.sql`:

```sql
if v_claims is null or v_claims = '' then
  v_role := 'super_admin';
```

The intent was to keep psql and the SQL editor working, and for today's
call paths it does only that. But "no claims" as a *default* means any
future path that reaches this function without PostgREST having set the GUC
— a trigger, `pg_cron`, a pooler that drops settings, a role granted EXECUTE
later — is handed `super_admin` and the entire document.

**Fixed**: the DBA case is asserted rather than assumed. A request that came
through PostgREST runs with `session_user` of `authenticator` (`SET LOCAL
ROLE` does not change `session_user`), and one arriving from there with no
claims is a bug, not a database administrator — so it now raises `42501`.
Direct connections as `postgres` are unaffected.

> Re-run `sql/002_admin_dashboard_gate.sql` against the database; the file is
> `create or replace` and safe to re-run.

---

## Knowingly left open

- **The forwarded-token posture itself.** Without `SUPABASE_SERVICE_ROLE_KEY`,
  a staff member's ordinary session on astropal.app can call
  `admin_dashboard` directly. This is written up at length in
  `sql/002_admin_dashboard_gate.sql` and closed by setting the key and
  revoking EXECUTE from `authenticated`. **Setting it is still the single
  biggest improvement available to this app**, and none of the above replaces
  it.

- **Session tokens in local storage.** The Supabase browser client's default.
  It is XSS-extractable by design; the CSP added above is the mitigation, not
  a cure.

- **Route gating is client-side.** `RequireAuth` decides what renders, not
  what is readable. That is sound here because the pages are empty shells and
  `/api/analytics` is the only source of data — but it means an unauthorised
  visitor sees a loading frame, not a 404.

- **Roles are cached for 60 seconds.** A revoked admin keeps access for up to
  a minute. Deliberate; shortening `ROLE_TTL_MS` is the knob.

- **Sign-in is not domain-restricted.** Any Google account can authenticate.
  Authorisation is entirely the `app_role` check, which is the right place
  for it, but it does mean the login screen is reachable by anyone.

- **Coupon write controls are shown to every staff role.** The dashboard does
  not use `caller_role` to hide create/edit/delete; enforcement lives in the
  FastAPI backend's own admin checks. Worth adding as defence in depth, but
  the authority is correctly server-side and is not in this repository.
