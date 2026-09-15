# Analytics

What every number on this dashboard means, what it deliberately does not
claim, and why the whole thing costs one database query a minute.

The companion document is `sql/001_admin_analytics.sql`, which is the only
place any of these numbers are computed.

---

## The shape of it

```
browser  ->  GET /api/analytics  ->  public.admin_analytics()  ->  one jsonb document
```

One call. Not one call per panel, not one per screen - one per visit, for the
whole dashboard.

That is the central design decision and everything else follows from it:

| Layer | What it does | Cost |
| --- | --- | --- |
| `public.admin_analytics(tz)` | Aggregates every number in Postgres and returns one jsonb document | 1 query |
| `app/api/analytics/route.ts` | Verifies the JWT, checks `app_role`, caches the document for 60s in module scope | 0 queries on a cache hit |
| `lib/analytics-context.tsx` | Holds the document above the router outlet | 0 requests when you change screen |

**Switching between Overview, Engagement, Users, Revenue, Reports and Support
costs nothing.** They are all reading the same object. Only a page reload or
the Refresh button goes back to the network, and only Refresh asks the server
to skip its own cache.

The function is bounded so it does not get slower as the product ages: every
time-bucketed figure looks back 400 days, the daily series is 90 points and the
monthly series is 24. All-time totals are counted separately, so the bound
costs no accuracy.

Six indexes were added for it (`sql/001_admin_analytics.sql`). `messages` had
none on `created_at`, because nothing in the product asks for messages by time -
the app reads them by session. Every trend line here does.

### Who is allowed to read it

The dashboard's questions are about other people's rows by definition - "how
many accounts signed up and then did nothing" cannot be expressed under row
level security, and `auth.users` is not reachable from a browser client at all.
So the privilege is lent for exactly one call, by a `SECURITY DEFINER`
function, and only after the caller has been shown to be staff or above.

```
browser JWT -> admin_dashboard()  [role check]  -> admin_analytics()
```

- `admin_analytics()` does the work. `EXECUTE` is granted to `service_role`
  alone, so nothing holding a customer session can call it directly.
- `admin_dashboard()` is the gate, and the only analytics function
  `authenticated` may execute. It reads `app_role` for `auth.uid()` and raises
  `insufficient_privilege` for anything below `staff`. Because it is
  `SECURITY DEFINER` it runs as the owner, which is how it can call
  `admin_analytics()` on behalf of a caller who could not.
- Both functions are read-only. There is no write path in either, by design:
  the admin app is an instrument, and the money columns stay service-role
  write only.

Verified against the live project: `anon` is refused at the grant
(`permission denied for function`), a signed-in customer and an unknown user id
are refused by the role check, and only `staff` / `admin` / `super_admin` get a
document back.

### The two deployment postures

`SUPABASE_SERVICE_ROLE_KEY` is **optional**, and setting it strictly improves
security with no code change.

| | Without the key (what runs today) | With the key |
| --- | --- | --- |
| Who checks the role | `admin_dashboard()`, in the database | The route handler, before it queries |
| Round trips per cache miss | 1 | 3 (verify JWT, read role, query) |
| Reachable from a browser | Yes, by a staff session | No, once revoked from `authenticated` |
| Secret to deploy | None | One |

To take the stronger posture:

1. Set `SUPABASE_SERVICE_ROLE_KEY` in the admin app's Vercel project
   (Production, Preview, Development). No `NEXT_PUBLIC_` prefix - that would
   ship it in the browser bundle.
2. Run `revoke execute on function public.admin_dashboard(text) from authenticated;`

The route prefers the key whenever it is present, so step 1 alone already
switches the path; step 2 is what closes the browser route.

**The exposure the current posture accepts**, written down so nobody
rediscovers it: a staff member's ordinary session on `astropal.app` can call
this RPC directly, which is the class of attack `require_admin_origin` closes
on the FastAPI admin routes (AskDisha `CLAUDE.md`: "Any new admin route needs
BOTH"). PostgREST has no equivalent origin control, so the role check is the
only gate. It is read-only and requires the victim to already be staff, but
script running in such a session could read the emails and revenue in this
document.

---

## What the numbers mean

### Active, and why it is not the same as signed in

An account is **active** on a day it did anything visible: asked a question,
made a kundali, queued a report, started a checkout, or held a session that was
used. Six signals, unioned into one (account, day) set that every active,
returning and retention figure is computed from.

**Sign-ins are a different number and a smaller one.** `auth.sessions` holds one
row per sign-in. A reader who opens the app every day on the same phone keeps
*one* session row, refreshed rather than replaced - so they are active every
day and signed in once. Never read sign-ins as app opens.

This is also why "came once and never came back" counts **distinct active days,
not session rows**. The session-row version called 374 of 444 accounts
one-and-done, the most loyal ones included.

### Questions

A question is one message a reader sent in chat (`messages.role = 'user'`).

**Quota questions** (`user_daily_usage.question_count`) is a different, lower
count: it is what the billing side charges for, and not every message spends a
question. Both are on the Engagement screen. When they drift far apart, people
are typing a lot without being charged - a cost question, not an engagement one.

### Categories - a sample, not a census

The product has no per-message topic column, and this dashboard does not invent
one. It reports the three category models the product itself writes:

| Source | What it is | Coverage |
| --- | --- | --- |
| `user_memories.category` | The category the astrologer assigned when it decided something was worth remembering | Only sessions that produced a memory. The Engagement screen prints the exact fraction. |
| `horoscope_life_events.event_category` | The category the **reader** chose when submitting a life event | Only submitted events |
| `report_queue.report_type` | Which report someone asked for | **Complete.** Every report ever requested is a row. |

Report types are the only complete demand signal, which is why the Reports
screen is the right place to answer "what do people want from us".

An earlier draft of this work shipped a regex classifier over message text. It
was removed. A second classifier that only the dashboard believes would report
a different answer from the one the product acts on, and a number nobody else
agrees with is worse than no number.

### Money

Every amount is stored in **paise** and converted once, at the edge, by
`rupees()` in `lib/analytics.ts`.

`payments` holds one row per order *created*, so the failures and the
abandonments are visible rather than inferred:

- **paid** - settled.
- **failed** - the gateway or the bank rejected it.
- **open** - created and never settled. An order moves created -> paid in one
  write, so anything still open an hour later was abandoned at the Razorpay
  modal. That is a pricing or trust problem at checkout, not a gateway failure,
  and the two need completely different fixes.

### Deltas

Every headline carries a comparison against a **named** period - today vs
yesterday, 7d vs the 7d before it, 30d vs the 30d before it.

When the comparison period was zero the delta is omitted rather than shown as
+100%. Growth from nothing is not a growth rate.

---

## What this dashboard cannot tell you

These are honest gaps, not bugs, and the dashboard does not estimate around
them.

### Page views: dashboard opens, Rashifal opens

**There is no page-view or event table in this database.** Nothing records that
someone opened the dashboard or read their Rashifal.

- `rashifal_cache` exists but is **dead**: the Rashifal route computes the
  reading on the fly from the Panchang dataset and never writes to it. The
  table has zero rows.
- Nothing else records a screen being opened.

The closest honest proxy is **active accounts**, which does include the reader
who opens the app and reads their Rashifal without asking anything - their
session refresh is one of the six signals. It cannot tell you *which* screen
they opened.

Adding real page counts means instrumenting the AskDisha frontend, which is a
separate repository and was explicitly out of scope for this work. The smallest
version would be one table and one call:

```sql
create table public.app_page_events (
  user_id text not null,
  page text not null,
  day date not null,
  views integer not null default 1,
  primary key (user_id, page, day)
);
-- service-role write only, upserted with views = views + 1
```

One upsert per user per page per day keeps the write volume to roughly one row
per active reader per screen per day, which is cheap. Until that exists, this
dashboard will not pretend to know.

### Sign-in history beyond what Supabase keeps

`auth.sessions` rows are removed when a session is revoked or expires, so
sign-in counts for older periods can undercount. Recent windows are reliable.

### Revenue attribution

There is no source or campaign field on `payments`, so the dashboard can say
what sold and what failed, but not what brought the buyer.

---

## Adding a metric

1. Add it to `public.admin_analytics()` in `sql/001_admin_analytics.sql`.
   Aggregate it once and join it onto the existing working sets (`_q`, `_act`,
   `_mem`, `_accounts`) rather than adding a new scan.
2. Apply the file. It is idempotent - `CREATE OR REPLACE` and
   `CREATE INDEX IF NOT EXISTS` throughout.
3. Add the field to the `Analytics` interface in `lib/analytics.ts`.
4. Render it. **Do not add a `fetch` to a page.** If a screen needs a number,
   the number belongs in the document.

The one exception in the app today is the Support screen, which reads tickets
live from the FastAPI backend because a ticket queue is something an admin
works through rather than a number they look at.

---

## Charts

`components/charts.tsx` holds every chart, in plain SVG. There is no charting
library, and the rules are not cosmetic:

- Colour comes from `--series-1..8` in `globals.css`, assigned in fixed order
  and **never cycled**. A ninth series folds into Other or the chart becomes
  small multiples.
- **Never a dual axis.** Two measures on different scales get two charts. A
  second y-scale lets whoever drew it choose where the lines cross, which is a
  claim the data never made - see the Revenue screen, where orders and rupees
  are two stacked charts for exactly this reason.
- Sequential encoding (the retention cohort grid) is one hue light to dark,
  never a rainbow, and every cell carries its percentage as text.
- **Text never wears the data colour.** Three of the eight light-mode slots sit
  below 3:1 contrast on white; a value painted in one would be unreadable.
  Identity comes from the coloured swatch beside the text.
- A legend for two or more series, always. One series needs none - the title
  says what is plotted.
- Both modes are selected, not flipped: the dark column is the same eight hues
  re-stepped for the dark surface, and the palette was validated against this
  app's actual surfaces (`#ffffff` / `#171717`) for lightness band, chroma
  floor, colour-vision-deficiency separation, normal-vision separation and
  contrast.
