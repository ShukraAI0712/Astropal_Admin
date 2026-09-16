# AstroPal Admin

Internal admin dashboard for AstroPal. Deployed separately from the main app at
`admin.astropal.app`.

Reads the same Supabase project as the AskDisha/AstroPal frontend, and the same
FastAPI backend (`api.astropal.app`) for support tickets and coupons. Access is
gated by `app_role` (`staff` / `admin` / `super_admin`).

## Sections

The app is a sidebar shell: a fixed rail on desktop, a hamburger drawer on a
phone. Every section is its own route, so it can be linked and bookmarked.

The four "today" tiles on the Overview are buttons. Each one opens a
full-screen list of the **people** it is counting, by name - who is live right
now, who was active, who signed up, who signed in - and every one of those
lists is already in the browser, so opening it costs no request. See
ANALYTICS.md for where the names come from.

| Route | What it answers | Access |
| --- | --- | --- |
| `/` | Overview - the headline numbers, who is on the app right now, the activity trend, and what needs attention | `staff` and above |
| `/journey` | Signed up → made a horoscope → asked → kept asking → came back, with the people who stopped at each step | `staff` and above |
| `/engagement` | How much is being asked, by whom, and what readers talk about | `staff` and above |
| `/users` | Signups, retention cohorts, who came back, and the email lists of accounts that never started | `staff` and above |
| `/revenue` | The whole checkout funnel: paid, failed, abandoned, by item, by customer | `staff` and above |
| `/reports` | Which reports people want, queue health, and every failure | `staff` and above |
| `/coupons` | Discount coupons: create, edit, disable, archive, usage analytics | `admin` to read, `super_admin` to change |
| `/support` | The support ticket queue | `staff` reads, `admin` edits |

Two documents explain the parts that carry rules rather than code:

- **[ANALYTICS.md](./ANALYTICS.md)** - what every number means, what the
  dashboard deliberately cannot tell you, and why the whole thing costs one
  database query a minute. Read it before adding a metric.
- **[COUPONS.md](./COUPONS.md)** - the coupon data model, its concurrency
  guarantees and its edge cases. Read it before changing anything that touches
  money.

## How the data gets here

Every number on every screen comes from **one** Postgres function,
`public.admin_analytics()`, defined in `sql/001_admin_analytics.sql`. It returns
the entire dashboard as a single jsonb document.

```
browser  ->  GET /api/analytics  ->  admin_analytics()  ->  one jsonb document
```

The route handler caches that document for 60 seconds, and the browser holds it
above the router outlet, so moving between screens costs no requests at all.
This is deliberate: a read-only dashboard should not be the most expensive
thing pointed at the database.

Access is gated by `public.admin_dashboard()`, which checks the caller's
`app_role` before lending them the privilege to run the analytics. Applying the
SQL is a one-off and both files are idempotent:

```bash
# Against the Supabase project, e.g. through the SQL editor or the CLI
psql "$DATABASE_URL" -f sql/001_admin_analytics.sql
psql "$DATABASE_URL" -f sql/002_admin_dashboard_gate.sql
```

Both are already applied to the live project.

## Getting started

```bash
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

## Environment variables

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project as the main app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key, safe to ship client-side |
| `NEXT_PUBLIC_API_URL` | FastAPI backend base URL (`https://api.astropal.app` in production) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Optional, and server only.** The dashboard works without it: the database gates access in `admin_dashboard()`. Setting it moves the check into the route handler and lets you make the analytics unreachable from any browser. No `NEXT_PUBLIC_` prefix, ever - that would put it in the browser bundle. See [ANALYTICS.md](./ANALYTICS.md#the-two-deployment-postures). |

Set the first three in the Vercel project settings for Production, Preview and
Development, not just locally. The fourth is a hardening step you can take at
any time.

## Deployment

Deploys to Vercel as its own project, domain `admin.astropal.app`. The backend's
`CORS_EXTRA_ORIGINS` (DigitalOcean App Platform env vars) must include this
app's origin.

## Checks

```bash
npm run lint     # eslint
npx tsc --noEmit # types
npm run build    # the build Vercel runs
```
