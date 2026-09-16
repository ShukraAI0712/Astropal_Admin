-- ---------------------------------------------------------------------------
-- 001_admin_analytics.sql
--
-- One function, one round trip, the whole dashboard.
--
-- A read-only screen should not be the most expensive thing pointed at the
-- database. `admin_analytics()` computes every number the dashboard renders in
-- a single call and returns one jsonb document; the Next.js route handler
-- caches it, so a dashboard left open all day costs one query a minute rather
-- than forty per refresh.
--
-- Two rules this file is written under:
--
--   * It only ever reads. The admin app is an instrument, not a control
--     panel, and the money columns stay service-role write only (see AskDisha
--     migrations 073 / 074).
--   * EXECUTE is granted to `service_role` only. The function is SECURITY
--     DEFINER because it reads `auth.users` and every per-user table, so
--     `anon` and `authenticated` must never reach it. The route handler
--     verifies the caller's JWT and their `app_role` before using the service
--     key.
--
-- It also invents nothing. Every category, every status and every label in
-- here is a column the product already writes. Where a number does not exist
-- in the database - a page view, a Rashifal open - this function does not
-- estimate one; see ANALYTICS.md for what is and is not measurable today.
--
-- Safe to re-run: everything is CREATE OR REPLACE / IF NOT EXISTS.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Indexes the analytics reads need
--
-- `messages` had no index on created_at, because nothing in the product asks
-- for messages by time - the app reads them by session. Every trend line on
-- this dashboard does ask by time, so without these the daily series is a
-- sequential scan of the whole table on every refresh.
-- ---------------------------------------------------------------------------

create index if not exists idx_messages_created_at
  on public.messages (created_at desc);

create index if not exists idx_messages_user_created
  on public.messages (created_at desc)
  where role = 'user';

create index if not exists idx_payments_created_at
  on public.payments (created_at desc);

create index if not exists idx_report_queue_created_at
  on public.report_queue (created_at desc);

create index if not exists idx_kundalis_created_at
  on public.kundalis (created_at desc);

create index if not exists idx_user_memories_created_at
  on public.user_memories (created_at desc);

-- An earlier draft of this file shipped a regex classifier that sorted chat
-- messages into life areas. It was a mistake and it is dropped here rather
-- than left behind: the product already has category models that a model
-- wrote and the database stores (`user_memories.category`,
-- `horoscope_life_events.event_category`, `report_queue.report_type`), and a
-- second classifier that only the dashboard believes would report a different
-- answer from the one the product acts on. The dashboard reads what exists.
drop function if exists public.admin_question_topic(text);
drop function if exists public.admin_question_script(text);

-- ---------------------------------------------------------------------------
-- The dashboard, in one document
-- ---------------------------------------------------------------------------

create or replace function public.admin_analytics(p_tz text default 'Asia/Kolkata')
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_today       date := (now() at time zone p_tz)::date;
  -- Everything time-bucketed is bounded to 400 days. All-time figures are
  -- counted separately, so the bound costs no accuracy - it only stops the
  -- series work from growing without limit as the product ages.
  v_start       date := (now() at time zone p_tz)::date - 400;
  v_start_ts    timestamptz := (v_start::timestamp at time zone p_tz);
  -- How recent a signal has to be to call somebody "live". Fifteen minutes
  -- rather than five: a session refresh is periodic, not continuous, so a
  -- tighter window would report people as gone while they are still reading.
  v_live_min    int := 15;

  v_kpis        jsonb;
  v_series      jsonb;
  v_categories  jsonb;
  v_engagement  jsonb;
  v_people      jsonb;
  v_journey     jsonb;
  v_users       jsonb;
  v_revenue     jsonb;
  v_reports     jsonb;
  v_coupons     jsonb;
  v_support     jsonb;
begin
  -- -------------------------------------------------------------------------
  -- Working sets every section below reads from, built once instead of once
  -- per panel.
  --
  -- _q   - one row per user chat message, bucketed into the business day.
  -- _act - one row per (account, day it did anything). The spine of every
  --        active / returning / retention number: an active day is a day the
  --        account did something we can see, from any of six signals, rather
  --        than whichever single table a panel happened to look at.
  -- _mem - the product's own category model. `user_memories` is what the
  --        astrologer chose to remember about a reader, and the model wrote
  --        the category itself. It is the closest thing in the database to
  --        "what was this conversation about", and it is real rather than
  --        re-derived. It covers only sessions where something was worth
  --        remembering - the coverage figure below says how many.
  -- -------------------------------------------------------------------------
  create temporary table _q on commit drop as
  select
    cs.user_id::text                              as user_id,
    m.session_id,
    m.created_at                                  as at,
    (m.created_at at time zone p_tz)::date        as day
  from public.messages m
  join public.chat_sessions cs on cs.id = m.session_id
  where m.role = 'user'
    and m.created_at >= v_start_ts;

  create index on _q (day);
  create index on _q (user_id);

  create temporary table _act on commit drop as
  select user_id, day
  from (
    select q.user_id, q.day from _q q
    union all
    select k.user_id::text, (k.created_at at time zone p_tz)::date
      from public.kundalis k where k.created_at >= v_start_ts
    union all
    select rq.user_id::text, (rq.created_at at time zone p_tz)::date
      from public.report_queue rq where rq.created_at >= v_start_ts
    union all
    select p.user_id::text, (p.created_at at time zone p_tz)::date
      from public.payments p where p.created_at >= v_start_ts
    union all
    select u.user_id::text, u.usage_date
      from public.user_daily_usage u where u.usage_date >= v_start
    union all
    -- A session row is a sign-in; refreshed_at is that session still being
    -- used. Between them they cover the reader who opens the app and reads
    -- their Rashifal without asking anything, who is invisible in every
    -- other table here.
    select s.user_id::text, (s.created_at at time zone p_tz)::date
      from auth.sessions s where s.created_at >= v_start_ts
    union all
    select s.user_id::text, ((s.refreshed_at at time zone 'UTC') at time zone p_tz)::date
      from auth.sessions s where s.refreshed_at >= (v_start_ts at time zone 'UTC')
  ) x
  where user_id is not null and day is not null
  group by 1, 2;

  create index on _act (day);
  create index on _act (user_id);

  create temporary table _mem on commit drop as
  select
    coalesce(um.category, 'Uncategorised')        as category,
    um.kind                                       as kind,
    um.session_id                                 as session_id,
    k.user_id::text                               as user_id,
    (um.created_at at time zone p_tz)::date       as day
  from public.user_memories um
  left join public.kundalis k on k.id = um.horoscope_id
  where um.is_active is not false
    and um.created_at >= v_start_ts;

  create index on _mem (day);

  -- Sign-in events. auth.sessions holds one row per sign-in, so a count of
  -- rows is sign-ins and a count of distinct users is people. It is NOT a
  -- count of app opens: a reader who keeps using the same phone keeps one
  -- session row, refreshed rather than replaced.
  create temporary table _logins on commit drop as
  select s.user_id::text as user_id, (s.created_at at time zone p_tz)::date as day
  from auth.sessions s
  where s.created_at >= v_start_ts;

  create index on _logins (day);

  -- Accounts, with the email the dashboard needs to actually reach someone and
  -- the name it needs to talk about them like people.
  --
  -- There is no name column on `user_profiles`. Three sources exist and they
  -- are tried in this order, which is deliberate:
  --
  --   1. `raw_user_meta_data->>'full_name'` - what the identity provider gave
  --      us at signup. This is the ACCOUNT HOLDER, which is the person a
  --      "who signed in" list is about.
  --   2. The name on their primary kundali. A fallback rather than the first
  --      choice, because a kundali is often drawn for somebody else: in the
  --      live data the account called Ajay has a chart for Pratibha on it, and
  --      greeting Ajay as Pratibha would be worse than showing an email.
  --   3. The local part of the email, title-cased, so a row is never nameless.
  --
  -- A full_name that is itself an email address is discarded rather than
  -- split - "first name: Shukra.ai.tech" is not a name.
  create temporary table _accounts on commit drop as
  select
    u.id::text                                    as user_id,
    u.email::text                                 as email,
    u.created_at                                  as created_at,
    (u.created_at at time zone p_tz)::date        as signup_day,
    u.last_sign_in_at                             as last_sign_in_at,
    coalesce(up.plan, 'basic')                    as plan,
    coalesce(up.app_role, 'user')                 as app_role,
    coalesce(up.onboarding_completed, false)      as onboarding_completed,
    coalesce(up.marketing_consent, false)         as marketing_consent,
    coalesce(up.whatsapp_connected, false)        as whatsapp_connected,
    nm.full_name                                  as full_name,
    initcap(split_part(nm.full_name, ' ', 1))     as first_name
  from auth.users u
  left join public.user_profiles up on up.user_id = u.id::text
  cross join lateral (
    select coalesce(
      case
        when u.raw_user_meta_data->>'full_name' like '%@%' then null
        else nullif(btrim(u.raw_user_meta_data->>'full_name'), '')
      end,
      (select nullif(btrim(k.name), '')
         from public.kundalis k
        where k.user_id = u.id
        order by k.is_primary desc nulls last, k.created_at asc
        limit 1),
      initcap(replace(split_part(u.email::text, '@', 1), '.', ' '))
    ) as full_name
  ) nm
  where u.deleted_at is null;

  create index on _accounts (user_id);

  -- -------------------------------------------------------------------------
  -- Who is here right now
  --
  -- The last timestamp of every visible signal, per account, for the last two
  -- days, and a label for whichever one was most recent. Two days rather than
  -- the 400 the rest of this function uses: nothing on screen asks "what was
  -- this person doing last March", and a `now()` cut keeps it to an index
  -- range on tables the other working sets already scan by date.
  --
  -- The priority in the ordering matters. A session row is written and
  -- refreshed at the same instant on sign-in, so without it "Signed in" and
  -- "App open" tie and the label is whichever one the aggregate happened to
  -- see. Real actions outrank presence.
  -- -------------------------------------------------------------------------
  create temporary table _seen on commit drop as
  select
    user_id,
    max(at)                                        as last_seen,
    (array_agg(what order by at desc, prio asc))[1] as doing
  from (
    select q.user_id, q.at, 'Asked a question'::text as what, 1 as prio
      from _q q where q.at >= now() - interval '2 days'
    union all
    select k.user_id::text, k.created_at, 'Made a horoscope', 2
      from public.kundalis k where k.created_at >= now() - interval '2 days'
    union all
    select rq.user_id::text, rq.created_at, 'Queued a report', 3
      from public.report_queue rq where rq.created_at >= now() - interval '2 days'
    union all
    select p.user_id::text, p.created_at, 'Started a checkout', 4
      from public.payments p where p.created_at >= now() - interval '2 days'
    union all
    select s.user_id::text, s.created_at, 'Signed in', 5
      from auth.sessions s where s.created_at >= now() - interval '2 days'
    union all
    select s.user_id::text, (s.refreshed_at at time zone 'UTC'), 'Has the app open', 6
      from auth.sessions s
     where s.refreshed_at >= ((now() - interval '2 days') at time zone 'UTC')
  ) x
  where user_id is not null
  group by 1;

  create index on _seen (user_id);

  -- -------------------------------------------------------------------------
  -- One row per account, one column per step of the journey
  --
  -- Everything the Journey screen reports is a filter on this table, so the
  -- funnel, the drop-off lists, the cohort trend and the per-person stage are
  -- all counted off the same definitions rather than four that drifted apart.
  --
  -- `q6_at` is the moment the sixth question was asked, and it is what
  -- "returned after that" is measured from: an account returned if it was
  -- active on a calendar day strictly LATER than the day it crossed five
  -- questions. Measuring from the account's last question instead would make
  -- returning impossible by construction.
  -- -------------------------------------------------------------------------
  create temporary table _journey on commit drop as
  with qn as (
    select user_id, count(*) as n, min(at) as first_at, count(distinct day) as q_days
    from _q group by 1
  ),
  q6 as (
    select user_id, at as q6_at, day as q6_day
    from (select user_id, at, day, row_number() over (partition by user_id order by at) rn from _q) z
    where rn = 6
  ),
  ku as (
    select user_id::text as user_id, count(*) as n, min(created_at) as first_at
    from public.kundalis group by 1
  ),
  rp as (
    select user_id, count(*) as n from public.report_queue group by 1
  ),
  pd as (
    select user_id, count(*) as n, min(coalesce(paid_at, created_at)) as first_at,
           coalesce(sum(amount), 0) as spend
    from public.payments where status = 'paid' group by 1
  ),
  ac as (
    select user_id, count(distinct day) as days, max(day) as last_day from _act group by 1
  )
  select
    a.user_id,
    a.email,
    a.first_name,
    a.full_name,
    a.plan,
    a.created_at,
    a.signup_day,
    coalesce(ku.n, 0)                     as kundalis,
    ku.first_at                           as first_kundali_at,
    coalesce(qn.n, 0)                     as questions,
    coalesce(qn.q_days, 0)                as question_days,
    qn.first_at                           as first_question_at,
    q6.q6_at                              as q6_at,
    coalesce(rp.n, 0)                     as reports,
    coalesce(pd.n, 0)                     as paid_orders,
    pd.first_at                           as first_paid_at,
    coalesce(pd.spend, 0)                 as spend,
    coalesce(ac.days, 0)                  as active_days,
    ac.last_day                           as last_active_day,
    (q6.q6_day is not null and exists (
       select 1 from _act x where x.user_id = a.user_id and x.day > q6.q6_day
     ))                                   as returned_after_5,
    case
      when coalesce(pd.n, 0) > 0 then 'Paying'
      when q6.q6_day is not null and exists (
             select 1 from _act x where x.user_id = a.user_id and x.day > q6.q6_day
           ) then 'Came back after 5+'
      when coalesce(qn.n, 0) > 5 then 'Asked more than 5'
      when coalesce(qn.n, 0) > 0 then 'Asked 1-5'
      when coalesce(ku.n, 0) > 0 then 'Made a horoscope'
      else 'Only signed up'
    end                                   as stage
  from _accounts a
  left join ku on ku.user_id = a.user_id
  left join qn on qn.user_id = a.user_id
  left join q6 on q6.user_id = a.user_id
  left join rp on rp.user_id = a.user_id
  left join pd on pd.user_id = a.user_id
  left join ac on ac.user_id = a.user_id;

  create index on _journey (user_id);
  create index on _journey (signup_day);

  -- =========================================================================
  -- Headline numbers
  --
  -- Every headline carries its own comparison period, because a number
  -- without one is not an insight: today vs yesterday, 7d vs the 7d before
  -- it, 30d vs the 30d before it.
  -- =========================================================================
  select jsonb_build_object(
    'questions', (
      select jsonb_build_object(
        'today',     count(*) filter (where day = v_today),
        'yesterday', count(*) filter (where day = v_today - 1),
        'd7',        count(*) filter (where day > v_today - 7),
        'prev7',     count(*) filter (where day > v_today - 14 and day <= v_today - 7),
        'd30',       count(*) filter (where day > v_today - 30),
        'prev30',    count(*) filter (where day > v_today - 60 and day <= v_today - 30),
        'd180',      count(*) filter (where day > v_today - 180),
        'd365',      count(*) filter (where day > v_today - 365),
        'all',       (select count(*) from public.messages where role = 'user')
      ) from _q
    ),
    'askers', (
      select jsonb_build_object(
        'today',     count(distinct user_id) filter (where day = v_today),
        'yesterday', count(distinct user_id) filter (where day = v_today - 1),
        'd7',        count(distinct user_id) filter (where day > v_today - 7),
        'prev7',     count(distinct user_id) filter (where day > v_today - 14 and day <= v_today - 7),
        'd30',       count(distinct user_id) filter (where day > v_today - 30),
        'prev30',    count(distinct user_id) filter (where day > v_today - 60 and day <= v_today - 30),
        'd180',      count(distinct user_id) filter (where day > v_today - 180),
        'd365',      count(distinct user_id) filter (where day > v_today - 365)
      ) from _q
    ),
    'active_users', (
      select jsonb_build_object(
        'today',     count(distinct user_id) filter (where day = v_today),
        'yesterday', count(distinct user_id) filter (where day = v_today - 1),
        'd7',        count(distinct user_id) filter (where day > v_today - 7),
        'prev7',     count(distinct user_id) filter (where day > v_today - 14 and day <= v_today - 7),
        'd30',       count(distinct user_id) filter (where day > v_today - 30),
        'prev30',    count(distinct user_id) filter (where day > v_today - 60 and day <= v_today - 30),
        'd180',      count(distinct user_id) filter (where day > v_today - 180),
        'd365',      count(distinct user_id) filter (where day > v_today - 365)
      ) from _act
    ),
    'new_users', (
      select jsonb_build_object(
        'today',     count(*) filter (where signup_day = v_today),
        'yesterday', count(*) filter (where signup_day = v_today - 1),
        'd7',        count(*) filter (where signup_day > v_today - 7),
        'prev7',     count(*) filter (where signup_day > v_today - 14 and signup_day <= v_today - 7),
        'd30',       count(*) filter (where signup_day > v_today - 30),
        'prev30',    count(*) filter (where signup_day > v_today - 60 and signup_day <= v_today - 30),
        'd180',      count(*) filter (where signup_day > v_today - 180),
        'd365',      count(*) filter (where signup_day > v_today - 365),
        'all',       count(*)
      ) from _accounts
    ),
    'logins', (
      select jsonb_build_object(
        'today',     count(*) filter (where day = v_today),
        'yesterday', count(*) filter (where day = v_today - 1),
        'd7',        count(*) filter (where day > v_today - 7),
        'prev7',     count(*) filter (where day > v_today - 14 and day <= v_today - 7),
        'd30',       count(*) filter (where day > v_today - 30),
        'prev30',    count(*) filter (where day > v_today - 60 and day <= v_today - 30),
        'd180',      count(*) filter (where day > v_today - 180),
        'd365',      count(*) filter (where day > v_today - 365)
      ) from _logins
    ),
    -- Revenue is in paise, as it is stored. The UI divides by 100 once.
    'revenue', (
      select jsonb_build_object(
        'today',     coalesce(sum(amount) filter (where d = v_today), 0),
        'yesterday', coalesce(sum(amount) filter (where d = v_today - 1), 0),
        'd7',        coalesce(sum(amount) filter (where d > v_today - 7), 0),
        'prev7',     coalesce(sum(amount) filter (where d > v_today - 14 and d <= v_today - 7), 0),
        'd30',       coalesce(sum(amount) filter (where d > v_today - 30), 0),
        'prev30',    coalesce(sum(amount) filter (where d > v_today - 60 and d <= v_today - 30), 0),
        'd180',      coalesce(sum(amount) filter (where d > v_today - 180), 0),
        'd365',      coalesce(sum(amount) filter (where d > v_today - 365), 0),
        'all',       (select coalesce(sum(amount), 0) from public.payments where status = 'paid')
      )
      from (
        select amount, (coalesce(paid_at, created_at) at time zone p_tz)::date as d
        from public.payments
        where status = 'paid' and coalesce(paid_at, created_at) >= v_start_ts
      ) paid
    ),
    'orders', (
      select jsonb_build_object(
        'today',     count(*) filter (where d = v_today),
        'yesterday', count(*) filter (where d = v_today - 1),
        'd7',        count(*) filter (where d > v_today - 7),
        'prev7',     count(*) filter (where d > v_today - 14 and d <= v_today - 7),
        'd30',       count(*) filter (where d > v_today - 30),
        'prev30',    count(*) filter (where d > v_today - 60 and d <= v_today - 30),
        'd180',      count(*) filter (where d > v_today - 180),
        'd365',      count(*) filter (where d > v_today - 365),
        'all',       (select count(*) from public.payments)
      )
      from (
        select (created_at at time zone p_tz)::date as d
        from public.payments where created_at >= v_start_ts
      ) o
    ),
    'reports', (
      select jsonb_build_object(
        'today',     count(*) filter (where d = v_today),
        'yesterday', count(*) filter (where d = v_today - 1),
        'd7',        count(*) filter (where d > v_today - 7),
        'prev7',     count(*) filter (where d > v_today - 14 and d <= v_today - 7),
        'd30',       count(*) filter (where d > v_today - 30),
        'prev30',    count(*) filter (where d > v_today - 60 and d <= v_today - 30),
        'd180',      count(*) filter (where d > v_today - 180),
        'd365',      count(*) filter (where d > v_today - 365),
        'all',       (select count(*) from public.report_queue)
      )
      from (
        select (created_at at time zone p_tz)::date as d
        from public.report_queue where created_at >= v_start_ts
      ) r
    )
  ) into v_kpis;

  -- =========================================================================
  -- Trend series
  --
  -- One daily series (90 days) and one monthly series (24 months). Every
  -- range the dashboard offers - today, 7d, 30d, 6m, 1y - is a window onto
  -- one of these two, so switching range on screen costs nothing.
  --
  -- Each metric is aggregated once and joined onto the calendar rather than
  -- asked per bucket. One grouped scan against ninety correlated subqueries
  -- is the difference between a cheap dashboard and an expensive one.
  -- =========================================================================
  select jsonb_build_object(
    'daily', (
      with days as (select (v_today - g.i) as d from generate_series(0, 89) g(i)),
      q  as (select day d, count(*) n, count(distinct user_id) u from _q
              where day > v_today - 90 group by 1),
      ac as (select day d, count(distinct user_id) u from _act
              where day > v_today - 90 group by 1),
      nu as (select signup_day d, count(*) n from _accounts
              where signup_day > v_today - 90 group by 1),
      lg as (select day d, count(*) n, count(distinct user_id) u from _logins
              where day > v_today - 90 group by 1),
      po as (select (created_at at time zone p_tz)::date d, count(*) n
               from public.payments where created_at >= v_start_ts group by 1),
      pp as (select (coalesce(paid_at, created_at) at time zone p_tz)::date d,
                    count(*) n, sum(amount) amt
               from public.payments
              where status = 'paid' and coalesce(paid_at, created_at) >= v_start_ts group by 1),
      rp as (select (created_at at time zone p_tz)::date d, count(*) n
               from public.report_queue where created_at >= v_start_ts group by 1)
      select coalesce(jsonb_agg(to_jsonb(x) order by x.d), '[]'::jsonb)
      from (
        select days.d::text            as d,
               coalesce(q.n, 0)        as questions,
               coalesce(q.u, 0)        as askers,
               coalesce(ac.u, 0)       as active,
               coalesce(nu.n, 0)       as new_users,
               coalesce(lg.n, 0)       as logins,
               coalesce(lg.u, 0)       as login_users,
               coalesce(po.n, 0)       as orders,
               coalesce(pp.n, 0)       as paid,
               coalesce(pp.amt, 0)     as revenue,
               coalesce(rp.n, 0)       as reports
        from days
        left join q  on q.d  = days.d
        left join ac on ac.d = days.d
        left join nu on nu.d = days.d
        left join lg on lg.d = days.d
        left join po on po.d = days.d
        left join pp on pp.d = days.d
        left join rp on rp.d = days.d
      ) x
    ),
    'monthly', (
      with months as (
        select to_char(date_trunc('month', v_today::timestamp)
                       - (g.i || ' months')::interval, 'YYYY-MM') as m
        from generate_series(0, 23) g(i)
      ),
      q  as (select to_char(day, 'YYYY-MM') m, count(*) n, count(distinct user_id) u
               from _q group by 1),
      ac as (select to_char(day, 'YYYY-MM') m, count(distinct user_id) u from _act group by 1),
      nu as (select to_char(signup_day, 'YYYY-MM') m, count(*) n from _accounts group by 1),
      lg as (select to_char(day, 'YYYY-MM') m, count(*) n, count(distinct user_id) u
               from _logins group by 1),
      po as (select to_char((created_at at time zone p_tz)::date, 'YYYY-MM') m, count(*) n
               from public.payments group by 1),
      pp as (select to_char((coalesce(paid_at, created_at) at time zone p_tz)::date, 'YYYY-MM') m,
                    count(*) n, sum(amount) amt
               from public.payments where status = 'paid' group by 1),
      rp as (select to_char((created_at at time zone p_tz)::date, 'YYYY-MM') m, count(*) n
               from public.report_queue group by 1)
      select coalesce(jsonb_agg(to_jsonb(x) order by x.d), '[]'::jsonb)
      from (
        select months.m             as d,
               coalesce(q.n, 0)     as questions,
               coalesce(q.u, 0)     as askers,
               coalesce(ac.u, 0)    as active,
               coalesce(nu.n, 0)    as new_users,
               coalesce(lg.n, 0)    as logins,
               coalesce(lg.u, 0)    as login_users,
               coalesce(po.n, 0)    as orders,
               coalesce(pp.n, 0)    as paid,
               coalesce(pp.amt, 0)  as revenue,
               coalesce(rp.n, 0)    as reports
        from months
        left join q  on q.m  = months.m
        left join ac on ac.m = months.m
        left join nu on nu.m = months.m
        left join lg on lg.m = months.m
        left join po on po.m = months.m
        left join pp on pp.m = months.m
        left join rp on rp.m = months.m
      ) x
    )
  ) into v_series;

  -- =========================================================================
  -- What people are talking about
  --
  -- Three category models, all of them written by the product and stored in
  -- the database. Nothing here is re-derived from message text.
  --
  --   memories     - `user_memories.category`, chosen by the model when it
  --                  decided something was worth remembering. The closest
  --                  thing to "what was this conversation about".
  --   life_events  - `horoscope_life_events.event_category`, chosen by the
  --                  READER when they submitted a life event.
  --   coverage     - what share of chat sessions produced a memory at all.
  --                  Without it the category mix looks like a census when it
  --                  is a sample, and a reader who asks about nothing
  --                  memorable is counted nowhere.
  -- =========================================================================
  select jsonb_build_object(
    'memories', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category,
               'today',    today,
               'd7',       d7,
               'd30',      d30,
               'd365',     d365,
               'total',    total,
               'users',    users,
               'sessions', sessions) order by total desc), '[]'::jsonb)
      from (
        select category,
               count(*) filter (where day = v_today)          today,
               count(*) filter (where day > v_today - 7)      d7,
               count(*) filter (where day > v_today - 30)     d30,
               count(*) filter (where day > v_today - 365)    d365,
               count(*)                                       total,
               count(distinct user_id)                        users,
               count(distinct session_id)                     sessions
        from _mem group by 1
      ) s
    ),
    'memories_by_kind', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', kind, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(kind, 'unknown') kind, count(*) n from _mem group by 1) s
    ),
    'memories_monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', mo, 'category', category, 'count', n) order by mo), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', day), 'YYYY-MM') mo, category, count(*) n
        from _mem where day > v_today - 365 group by 1, 2
      ) s
    ),
    'life_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'category', category, 'count', n, 'charts', c) order by n desc), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(event_category), ''), 'Uncategorised') category,
               count(*) n, count(distinct horoscope_id) c
        from public.horoscope_life_events
        where is_active is not false
        group by 1
      ) s
    ),
    'coverage', (
      select jsonb_build_object(
        'sessions_with_memory', (select count(distinct session_id) from _mem where session_id is not null),
        'sessions_total',       (select count(*) from public.chat_sessions),
        'memories_total',       (select count(*) from public.user_memories where is_active is not false),
        'first_memory_at',      (select min(created_at) from public.user_memories)
      )
    )
  ) into v_categories;

  -- =========================================================================
  -- Engagement: who is asking, and how much
  -- =========================================================================
  select jsonb_build_object(
    'today_by_user', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', user_id, 'email', email, 'questions', n, 'plan', plan) order by n desc), '[]'::jsonb)
      from (
        select q.user_id, a.email, a.plan, count(*) n
        from _q q left join _accounts a on a.user_id = q.user_id
        where q.day = v_today
        group by 1, 2, 3
        order by n desc
        limit 100
      ) s
    ),
    'top_askers_30d', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', user_id, 'email', email, 'questions', n, 'plan', plan, 'days_active', d) order by n desc), '[]'::jsonb)
      from (
        select q.user_id, a.email, a.plan, count(*) n, count(distinct q.day) d
        from _q q left join _accounts a on a.user_id = q.user_id
        where q.day > v_today - 30
        group by 1, 2, 3
        order by n desc
        limit 25
      ) s
    ),
    -- The distribution matters more than the average. One reader with 400
    -- questions and 300 with one is not the same product as 300 readers with
    -- five each, and a mean cannot tell them apart.
    'distribution_30d', (
      select jsonb_build_object(
        'q1',      count(*) filter (where n = 1),
        'q2_5',    count(*) filter (where n between 2 and 5),
        'q6_20',   count(*) filter (where n between 6 and 20),
        'q21_50',  count(*) filter (where n between 21 and 50),
        'q51plus', count(*) filter (where n > 50),
        'median',  coalesce(percentile_disc(0.5) within group (order by n), 0),
        'mean',    round(coalesce(avg(n), 0), 1)
      )
      from (select user_id, count(*) n from _q where day > v_today - 30 group by 1) s
    ),
    'chat_sessions', (
      select jsonb_build_object(
        'today',  count(*) filter (where d = v_today),
        'd7',     count(*) filter (where d > v_today - 7),
        'd30',    count(*) filter (where d > v_today - 30),
        'all',    (select count(*) from public.chat_sessions),
        'avg_questions_per_session',
          round(coalesce((select avg(n) from (select session_id, count(*) n from _q group by 1) x), 0), 1)
      )
      from (select (created_at at time zone p_tz)::date d
              from public.chat_sessions where created_at >= v_start_ts) s
    ),
    -- Quota-counted questions, the number the billing side of the product
    -- sees. Lower than the chat count on purpose: not every message spends a
    -- question.
    'quota_questions', (
      select jsonb_build_object(
        'today', coalesce(sum(question_count) filter (where usage_date = v_today), 0),
        'd7',    coalesce(sum(question_count) filter (where usage_date > v_today - 7), 0),
        'd30',   coalesce(sum(question_count) filter (where usage_date > v_today - 30), 0),
        'all',   (select coalesce(sum(question_count), 0) from public.user_daily_usage)
      ) from public.user_daily_usage where usage_date >= v_start
    )
  ) into v_engagement;

  -- =========================================================================
  -- People: the names behind today's numbers
  --
  -- Every other section of this document is a count. This one is the list the
  -- count was made of, because "13 active today" and "Nitika, Ritik and Vani
  -- are on right now" are different tools: you read the first and you act on
  -- the second.
  --
  -- Each list is capped. A day with two hundred signups is a day for the
  -- Users screen, not for a modal.
  -- =========================================================================
  select jsonb_build_object(
    -- Live = a visible signal within the window. `Has the app open` is a
    -- session refresh, which is the only thing a reader who is just reading
    -- produces; without it "live" would mean "typing", and most people on the
    -- app at any moment are not typing.
    'live', jsonb_build_object(
      'window_minutes', v_live_min,
      'count', (select count(*) from _seen
                 where last_seen >= now() - (v_live_min || ' minutes')::interval),
      'list', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', s.user_id, 'first_name', a.first_name, 'full_name', a.full_name,
                 'email', a.email, 'plan', a.plan, 'last_seen', s.last_seen,
                 'seconds_ago', round(extract(epoch from (now() - s.last_seen))),
                 'doing', s.doing,
                 'questions_today', coalesce(qt.n, 0),
                 'is_new', a.signup_day = v_today,
                 'stage', j.stage) order by s.last_seen desc)
        from _seen s
        join _accounts a on a.user_id = s.user_id
        left join _journey j on j.user_id = s.user_id
        left join (select user_id, count(*) n from _q where day = v_today group by 1) qt
               on qt.user_id = s.user_id
        where s.last_seen >= now() - (v_live_min || ' minutes')::interval), '[]'::jsonb)
    ),

    'today', jsonb_build_object(
      -- Accounts created today, and how far each one got before the page was
      -- rendered. A signup that already has a horoscope on it is a different
      -- event from one that stopped at the email.
      'new_signups', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', j.user_id, 'first_name', j.first_name, 'full_name', j.full_name,
                 'email', j.email, 'plan', j.plan, 'signed_up', j.created_at,
                 'kundalis', j.kundalis, 'questions', j.questions,
                 'stage', j.stage, 'last_seen', s.last_seen) order by j.created_at desc)
        from (select * from _journey where signup_day = v_today
               order by created_at desc limit 200) j
        left join _seen s on s.user_id = j.user_id), '[]'::jsonb),

      -- New sessions started today. Not app opens - see ANALYTICS.md.
      'signed_in', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', l.user_id, 'first_name', a.first_name, 'full_name', a.full_name,
                 'email', a.email, 'plan', a.plan, 'logins', l.n,
                 'signed_up', a.created_at, 'is_new', a.signup_day = v_today,
                 'questions', coalesce(qt.n, 0), 'stage', j.stage,
                 'last_seen', s.last_seen) order by l.n desc, a.first_name)
        from (select user_id, count(*) n from _logins where day = v_today
               group by 1 limit 200) l
        join _accounts a on a.user_id = l.user_id
        left join _journey j on j.user_id = l.user_id
        left join _seen s on s.user_id = l.user_id
        left join (select user_id, count(*) n from _q where day = v_today group by 1) qt
               on qt.user_id = l.user_id), '[]'::jsonb),

      -- Everyone active today from any of the six signals, with what each one
      -- actually did. This is the list the "Active today" tile is counting.
      'active', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', t.user_id, 'first_name', a.first_name, 'full_name', a.full_name,
                 'email', a.email, 'plan', a.plan,
                 'questions', coalesce(qt.n, 0),
                 'kundalis', coalesce(kt.n, 0),
                 'reports', coalesce(rt.n, 0),
                 'orders', coalesce(pt.n, 0),
                 'is_new', a.signup_day = v_today,
                 'stage', j.stage,
                 'doing', s.doing, 'last_seen', s.last_seen)
                 order by s.last_seen desc nulls last, coalesce(qt.n, 0) desc)
        from (select distinct user_id from _act where day = v_today limit 300) t
        join _accounts a on a.user_id = t.user_id
        left join _journey j on j.user_id = t.user_id
        left join _seen s on s.user_id = t.user_id
        left join (select user_id, count(*) n from _q where day = v_today group by 1) qt
               on qt.user_id = t.user_id
        left join (select user_id::text uid, count(*) n from public.kundalis
                    where (created_at at time zone p_tz)::date = v_today group by 1) kt
               on kt.uid = t.user_id
        left join (select user_id uid, count(*) n from public.report_queue
                    where (created_at at time zone p_tz)::date = v_today group by 1) rt
               on rt.uid = t.user_id
        left join (select user_id uid, count(*) n from public.payments
                    where (created_at at time zone p_tz)::date = v_today group by 1) pt
               on pt.uid = t.user_id), '[]'::jsonb)
    )
  ) into v_people;

  -- =========================================================================
  -- The journey: signed up -> made a horoscope -> asked -> kept asking ->
  -- came back
  --
  -- Five steps, counted off `_journey`, which holds one row per account. Two
  -- things make this a funnel rather than five unrelated counts:
  --
  --   * The steps are nested in the live data - every account that has asked
  --     a question has a horoscope, because the product cannot open a chat
  --     without one. Verified, not assumed: `asked without a horoscope` is
  --     reported alongside so the day that stops being true is visible
  --     instead of silently breaking the shape.
  --   * Every step is measured over the SAME cohort of accounts, selected by
  --     when they signed up. Counting "signups this month" against "questions
  --     this month" is the classic way to draw a funnel that describes two
  --     different populations.
  --
  -- The cost of the cohort rule is that recent windows understate every step
  -- after the first: an account that signed up yesterday has not had time to
  -- ask six questions. That is why the 30-day window is offered next to the
  -- all-time one rather than instead of it, and why the screen says so.
  -- =========================================================================
  select jsonb_build_object(
    'windows', (
      select jsonb_object_agg(w.name, w.doc)
      from (
        select
          win.name,
          jsonb_build_object(
            'days',            win.days,
            'signed_up',       count(*),
            'made_kundali',    count(*) filter (where j.kundalis > 0),
            'asked_any',       count(*) filter (where j.questions > 0),
            'asked_over_5',    count(*) filter (where j.questions > 5),
            'returned_after',  count(*) filter (where j.returned_after_5),
            'paid',            count(*) filter (where j.paid_orders > 0),
            'queued_report',   count(*) filter (where j.reports > 0),
            -- The two shape checks. Both are zero today; if either stops
            -- being zero the funnel above is no longer a chain.
            'asked_without_kundali', count(*) filter (where j.questions > 0 and j.kundalis = 0),
            'paid_without_asking',   count(*) filter (where j.paid_orders > 0 and j.questions = 0)
          ) as doc
        from (values ('d30', 30), ('d90', 90), ('d365', 365), ('all', null::int))
               as win(name, days)
        join _journey j on j.signup_day > v_today - coalesce(win.days, 100000)
        group by win.name, win.days
      ) w
    ),

    -- How long each step takes, as a median rather than a mean: one account
    -- that signed up in March and asked its first question in September would
    -- move an average by weeks and a median not at all.
    --
    -- In MINUTES, and not because minutes are the natural unit for a funnel.
    -- They are the unit this product actually runs at: the median account
    -- reaches its horoscope, its first question AND its sixth inside the
    -- first session. Reported in hours these all round to 0.0, which reads
    -- like a broken query rather than the most important thing on the screen.
    'timing', (
      select jsonb_build_object(
        'minutes_to_kundali', round(percentile_cont(0.5) within group (
          order by extract(epoch from (first_kundali_at - created_at)) / 60.0)
          filter (where first_kundali_at is not null)::numeric, 1),
        'minutes_to_first_question', round(percentile_cont(0.5) within group (
          order by extract(epoch from (first_question_at - created_at)) / 60.0)
          filter (where first_question_at is not null)::numeric, 1),
        'minutes_kundali_to_question', round(percentile_cont(0.5) within group (
          order by extract(epoch from (first_question_at - first_kundali_at)) / 60.0)
          filter (where first_question_at is not null and first_kundali_at is not null)::numeric, 1),
        'minutes_to_sixth_question', round(percentile_cont(0.5) within group (
          order by extract(epoch from (q6_at - created_at)) / 60.0)
          filter (where q6_at is not null)::numeric, 1),
        'median_questions_of_askers', coalesce(percentile_disc(0.5) within group (
          order by questions) filter (where questions > 0), 0),
        'median_active_days_of_returners', coalesce(percentile_disc(0.5) within group (
          order by active_days) filter (where returned_after_5), 0)
      ) from _journey
    ),

    -- Where accounts stand, each counted exactly once, in the order the
    -- journey runs. This is the same population as `windows.all` sliced by
    -- furthest step reached rather than by step reached at all.
    'stages', (
      select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
      from (select stage, count(*) n from _journey group by 1) s
    ),

    -- Is the funnel getting better? One row per signup month, so a change to
    -- onboarding shows up as a step that moved rather than a total that did.
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', m, 'signed_up', signed_up, 'made_kundali', made_kundali,
               'asked_any', asked_any, 'asked_over_5', asked_over_5,
               'returned_after', returned_after) order by m), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', signup_day), 'YYYY-MM') m,
               count(*) signed_up,
               count(*) filter (where kundalis > 0) made_kundali,
               count(*) filter (where questions > 0) asked_any,
               count(*) filter (where questions > 5) asked_over_5,
               count(*) filter (where returned_after_5) returned_after
        from _journey where signup_day > v_today - 365 group by 1
      ) s
    ),

    -- The four leaks, as people rather than percentages. Each list is the
    -- accounts that reached one step and not the next, newest first, with the
    -- email needed to do something about it.
    --
    -- One scan, four buckets. The bucket is chosen by a lateral VALUES rather
    -- than by four separate passes over the same table, and `count(*)` is the
    -- whole bucket while the list is capped at a hundred - so a panel header
    -- can say "showing 100 of 238" truthfully.
    'stalled', (
      select jsonb_object_agg(k.kind,
               coalesce(d.doc, jsonb_build_object('count', 0, 'list', '[]'::jsonb)))
      from (values ('no_kundali'), ('kundali_no_question'),
                   ('asked_under_6'), ('no_return')) k(kind)
      left join (
        select
          kind,
          jsonb_build_object(
            'count', count(*),
            'list', coalesce(jsonb_agg(jsonb_build_object(
                      'user_id', user_id, 'first_name', first_name, 'full_name', full_name,
                      'email', email, 'plan', plan, 'signed_up', created_at,
                      'days_since', (v_today - signup_day),
                      'kundalis', kundalis, 'questions', questions,
                      'last_active', last_active_day) order by created_at desc)
                      filter (where rn <= 100), '[]'::jsonb)
          ) as doc
        from (
          select j.*, b.kind,
                 row_number() over (partition by b.kind order by j.created_at desc) rn
          from _journey j
          cross join lateral (values
            ('no_kundali',          j.kundalis = 0),
            ('kundali_no_question', j.kundalis > 0 and j.questions = 0),
            ('asked_under_6',       j.questions between 1 and 5),
            ('no_return',           j.questions > 5 and not j.returned_after_5)
          ) b(kind, hit)
          where b.hit
        ) z
        group by kind
      ) d on d.kind = k.kind
    )
  ) into v_journey;

  -- =========================================================================
  -- Users: who signed up, who came back, and who never started
  -- =========================================================================

  -- Accounts that signed up and then did nothing at all: no kundali, no
  -- chat, no report, no order. The email is the point of this list - it is a
  -- re-activation campaign, not a statistic.
  create temporary table _ghosts on commit drop as
  select a.* from _accounts a
  where not exists (select 1 from public.kundalis k where k.user_id::text = a.user_id)
    and not exists (select 1 from public.chat_sessions cs where cs.user_id::text = a.user_id)
    and not exists (select 1 from public.report_queue rq where rq.user_id = a.user_id)
    and not exists (select 1 from public.payments p where p.user_id = a.user_id);

  -- Came once and never came back: active on exactly one calendar day, ever.
  --
  -- The obvious definition - one row in auth.sessions - is wrong, and wrong
  -- in a way that flatters nobody. A reader who opens the app every day on
  -- the same phone keeps ONE session row; it is refreshed, not replaced.
  -- Counting session rows called 374 of 444 accounts one-and-done, the most
  -- loyal ones included. Distinct active days is the honest version.
  create temporary table _never_returned on commit drop as
  select a.*, d.days
  from _accounts a
  join (select user_id, count(distinct day) days from _act group by 1) d
       on d.user_id = a.user_id
  where d.days = 1;

  select jsonb_build_object(
    'total',        (select count(*) from _accounts),
    'by_plan',      (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb)
                       from (select plan, count(*) n from _accounts group by 1) s),
    'by_role',      (select coalesce(jsonb_object_agg(app_role, n), '{}'::jsonb)
                       from (select app_role, count(*) n from _accounts group by 1) s),
    'marketing_consent', (select count(*) from _accounts where marketing_consent),
    'whatsapp_connected', (select count(*) from _accounts where whatsapp_connected),
    'onboarding_incomplete', (select count(*) from _accounts where not onboarding_completed),

    'ghosts', jsonb_build_object(
      'count', (select count(*) from _ghosts),
      'list', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', user_id, 'email', email, 'first_name', first_name,
                 'created_at', created_at, 'days_since', (v_today - signup_day)) order by created_at desc)
        from (select * from _ghosts order by created_at desc limit 200) lim), '[]'::jsonb)
    ),

    'never_returned', jsonb_build_object(
      'count', (select count(*) from _never_returned),
      'list', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', user_id, 'email', email, 'first_name', first_name,
                 'created_at', created_at, 'last_sign_in_at', last_sign_in_at) order by created_at desc)
        from (select * from _never_returned order by created_at desc limit 100) lim), '[]'::jsonb)
    ),

    'logged_in_today', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', user_id, 'email', email, 'first_name', first_name,
               'logins', n, 'plan', plan,
               'signed_up', created_at, 'is_new', signup_day = v_today) order by n desc), '[]'::jsonb)
      from (
        select l.user_id, a.email, a.first_name, a.plan, a.created_at, a.signup_day, count(*) n
        from _logins l left join _accounts a on a.user_id = l.user_id
        where l.day = v_today
        group by 1, 2, 3, 4, 5, 6
        limit 200
      ) s
    ),

    -- Returning = came back on more than one distinct day in the window. A
    -- second visit is the first real signal that the product stuck.
    'returning', jsonb_build_object(
      'd7', (
        select jsonb_build_object(
          'active', count(*),
          'multi_day', count(*) filter (where d > 1),
          'rate', case when count(*) = 0 then 0
                       else round(100.0 * count(*) filter (where d > 1) / count(*), 1) end)
        from (select user_id, count(distinct day) d from _act where day > v_today - 7 group by 1) s
      ),
      'd30', (
        select jsonb_build_object(
          'active', count(*),
          'multi_day', count(*) filter (where d > 1),
          'rate', case when count(*) = 0 then 0
                       else round(100.0 * count(*) filter (where d > 1) / count(*), 1) end)
        from (select user_id, count(distinct day) d from _act where day > v_today - 30 group by 1) s
      ),
      'd180', (
        select jsonb_build_object(
          'active', count(*),
          'multi_day', count(*) filter (where d > 1),
          'rate', case when count(*) = 0 then 0
                       else round(100.0 * count(*) filter (where d > 1) / count(*), 1) end)
        from (select user_id, count(distinct day) d from _act where day > v_today - 180 group by 1) s
      )
    ),

    -- New vs returning among today's actives: growth or retention, separated.
    'today_split', (
      select jsonb_build_object(
        'new',       count(*) filter (where a.signup_day = v_today),
        'returning', count(*) filter (where a.signup_day is distinct from v_today)
      )
      from (select distinct user_id from _act where day = v_today) t
      left join _accounts a on a.user_id = t.user_id
    ),

    -- Signup-week cohorts, and how many of each week's accounts were still
    -- active one, two, three and four weeks later.
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week', week, 'size', size,
               'w1', w1, 'w2', w2, 'w3', w3, 'w4', w4) order by week desc), '[]'::jsonb)
      from (
        select
          to_char(c.cw, 'YYYY-MM-DD') week,
          count(distinct c.user_id) size,
          count(distinct a.user_id) filter (where a.aw = c.cw + 7)  w1,
          count(distinct a.user_id) filter (where a.aw = c.cw + 14) w2,
          count(distinct a.user_id) filter (where a.aw = c.cw + 21) w3,
          count(distinct a.user_id) filter (where a.aw = c.cw + 28) w4
        from (select user_id, date_trunc('week', signup_day)::date cw
                from _accounts where signup_day > v_today - 126) c
        left join (select distinct user_id, date_trunc('week', day)::date aw from _act) a
               on a.user_id = c.user_id
        group by 1
      ) s
    ),

    -- How long accounts survive, and how deep the habit went. Dormant and
    -- one-day are the two numbers to watch: together they are the leak.
    'lifecycle', (
      select jsonb_build_object(
        'active_7d',    count(*) filter (where last_day > v_today - 7),
        'active_30d',   count(*) filter (where last_day > v_today - 30),
        'dormant_30_90',count(*) filter (where last_day <= v_today - 30 and last_day > v_today - 90),
        'dormant_90',   count(*) filter (where last_day <= v_today - 90),
        'never_active', (select count(*) from _ghosts),
        'days_1',       count(*) filter (where days = 1),
        'days_2_3',     count(*) filter (where days between 2 and 3),
        'days_4_7',     count(*) filter (where days between 4 and 7),
        'days_8plus',   count(*) filter (where days > 7)
      )
      from (select user_id, max(day) last_day, count(distinct day) days
              from _act group by 1) s
    )
  ) into v_users;

  -- =========================================================================
  -- Revenue: the whole funnel, not just what landed
  --
  -- `payments` holds one row per created order, so the failures and the
  -- abandonments are in here too - which is the only way to see how much
  -- money tried to arrive and did not.
  -- =========================================================================
  select jsonb_build_object(
    'funnel', (
      select jsonb_build_object(
        'd7',  jsonb_build_object(
          'created', count(*) filter (where d > v_today - 7),
          'paid',    count(*) filter (where d > v_today - 7 and status = 'paid'),
          'failed',  count(*) filter (where d > v_today - 7 and status = 'failed'),
          'open',    count(*) filter (where d > v_today - 7 and status = 'created')),
        'd30', jsonb_build_object(
          'created', count(*) filter (where d > v_today - 30),
          'paid',    count(*) filter (where d > v_today - 30 and status = 'paid'),
          'failed',  count(*) filter (where d > v_today - 30 and status = 'failed'),
          'open',    count(*) filter (where d > v_today - 30 and status = 'created')),
        'd365', jsonb_build_object(
          'created', count(*) filter (where d > v_today - 365),
          'paid',    count(*) filter (where d > v_today - 365 and status = 'paid'),
          'failed',  count(*) filter (where d > v_today - 365 and status = 'failed'),
          'open',    count(*) filter (where d > v_today - 365 and status = 'created')),
        'all', jsonb_build_object(
          'created', (select count(*) from public.payments),
          'paid',    (select count(*) from public.payments where status = 'paid'),
          'failed',  (select count(*) from public.payments where status = 'failed'),
          'open',    (select count(*) from public.payments where status = 'created')),
        -- An order still 'created' an hour later was abandoned at the
        -- Razorpay modal. That is a UX number, not a payments number.
        'abandoned', (select count(*) from public.payments
                       where status = 'created' and created_at < now() - interval '1 hour')
      )
      from (select status, (created_at at time zone p_tz)::date d
              from public.payments where created_at >= v_start_ts) p
    ),
    'by_item', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'item', item, 'created', created, 'paid', paid, 'failed', failed,
               'revenue', revenue, 'buyers', buyers) order by revenue desc), '[]'::jsonb)
      from (
        select item,
               count(*) created,
               count(*) filter (where status = 'paid') paid,
               count(*) filter (where status = 'failed') failed,
               coalesce(sum(amount) filter (where status = 'paid'), 0) revenue,
               count(distinct user_id) filter (where status = 'paid') buyers
        from public.payments group by 1
      ) s
    ),
    'failures', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc), '[]'::jsonb)
      from (
        select coalesce(nullif(btrim(failure_reason), ''), 'Not recorded') reason, count(*) n
        from public.payments where status = 'failed' group by 1 order by n desc limit 15
      ) s
    ),
    'customers', (
      select jsonb_build_object(
        'paying',        count(*),
        'repeat',        count(*) filter (where n > 1),
        'lifetime_avg',  round(coalesce(avg(spend), 0) / 100.0, 0),
        'lifetime_max',  round(coalesce(max(spend), 0) / 100.0, 0)
      )
      from (select user_id, count(*) n, sum(amount) spend
              from public.payments where status = 'paid' group by 1) s
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', s.user_id, 'email', a.email, 'orders', n,
               'spend', spend, 'plan', a.plan) order by spend desc), '[]'::jsonb)
      from (select user_id, count(*) n, sum(amount) spend
              from public.payments where status = 'paid' group by 1
             order by spend desc limit 20) s
      left join _accounts a on a.user_id = s.user_id
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'created_at', p.created_at, 'paid_at', p.paid_at, 'email', a.email,
               'item', p.item, 'amount', p.amount, 'original_amount', p.original_amount,
               'discount_amount', p.discount_amount, 'status', p.status,
               'failure_reason', p.failure_reason, 'coupon_code', p.coupon_code,
               'settled_via', p.settled_via) order by p.created_at desc), '[]'::jsonb)
      from (select * from public.payments order by created_at desc limit 50) p
      left join _accounts a on a.user_id = p.user_id
    ),
    'subscriptions', jsonb_build_object(
      'total',     (select count(*) from public.subscriptions),
      'active',    (select count(*) from public.subscriptions where status = 'active'),
      'cancelled', (select count(*) from public.subscriptions where cancelled_at is not null),
      'by_plan',   coalesce((select jsonb_object_agg(plan, n)
                               from (select plan, count(*) n from public.subscriptions
                                      where plan is not null group by 1) s), '{}'::jsonb)
    ),
    'plan_churn', (
      select jsonb_build_object(
        'cancelled_30d', count(*) filter (where plan_cancelled
                           and (plan_cancelled_at at time zone p_tz)::date > v_today - 30),
        'expiring_7d',   count(*) filter (where plan in ('pro', 'ultra')
                           and plan_expires_at is not null
                           and plan_expires_at between now() and now() + interval '7 days'),
        'auto_renew_on', count(*) filter (where auto_renew)
      )
      from public.user_profiles
    )
  ) into v_revenue;

  -- =========================================================================
  -- Reports
  --
  -- `report_queue.report_type` is the third category model in the product,
  -- and the only one that is complete: every report anyone asked for is a
  -- row here. It is the demand signal the other two only hint at.
  -- =========================================================================
  select jsonb_build_object(
    'by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'type', report_type, 'today', today, 'd7', d7, 'd30', d30,
               'total', total, 'failed', failed, 'users', users) order by total desc), '[]'::jsonb)
      from (
        select report_type,
               count(*) filter (where (created_at at time zone p_tz)::date = v_today) today,
               count(*) filter (where (created_at at time zone p_tz)::date > v_today - 7) d7,
               count(*) filter (where (created_at at time zone p_tz)::date > v_today - 30) d30,
               count(*) total,
               count(*) filter (where status = 'failed') failed,
               count(distinct user_id) users
        from public.report_queue group by 1
      ) s
    ),
    'queue', (
      select jsonb_build_object(
        'pending',   count(*) filter (where status in ('pending', 'processing')),
        'failed',    count(*) filter (where status = 'failed'),
        'completed', count(*) filter (where status = 'completed'),
        'success_rate', case when count(*) filter (where status in ('completed', 'failed')) = 0 then 0
                        else round(100.0 * count(*) filter (where status = 'completed')
                             / count(*) filter (where status in ('completed', 'failed')), 1) end,
        'avg_seconds', round(coalesce(avg(extract(epoch from (completed_at - started_at)))
                        filter (where status = 'completed' and started_at is not null), 0), 0)
      ) from public.report_queue
    ),
    'failures', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'report_type', report_type, 'last_error', last_error,
               'attempt_count', attempt_count, 'updated_at', updated_at) order by updated_at desc), '[]'::jsonb)
      from (select report_type, last_error, attempt_count, updated_at
              from public.report_queue where status = 'failed'
             order by updated_at desc limit 15) s
    ),
    'saved', jsonb_build_object(
      'career', (select count(*) from public.career_reports),
      'relationship', (select count(*) from public.relationship_reports),
      'wealth', (select count(*) from public.wealth_reports),
      'vedic_health', (select count(*) from public.vedic_health_reports),
      'compatibility', (select count(*) from public.compatibility_reports),
      'baby_name', (select count(*) from public.baby_name_reports),
      'life_numerology', (select count(*) from public.life_numerology_reports),
      'marriage_life', (select count(*) from public.marriage_life_reports),
      'varshphal', (select count(*) from public.varshphal_reports)
    )
  ) into v_reports;

  -- =========================================================================
  -- Coupons: the summary the overview shows. The coupons screen has its own
  -- endpoints on the backend for everything a coupon can do.
  -- =========================================================================
  select jsonb_build_object(
    'total',    (select count(*) from public.coupons),
    'active',   (select count(*) from public.coupons
                  where lifecycle = 'active'
                    and (starts_at is null or starts_at <= now())
                    and (expires_at is null or expires_at > now())),
    'redemptions', (
      select jsonb_build_object(
        'live',     count(*) filter (where status <> 'released'),
        'released', count(*) filter (where status = 'released'),
        'discount_given', coalesce(sum(discount_amount) filter (where status = 'redeemed'), 0)
      ) from public.coupon_redemptions
    ),
    'attempts', (
      select jsonb_build_object(
        'total',   count(*),
        'success', count(*) filter (where outcome = 'success'),
        'failure', count(*) filter (where outcome = 'failure'),
        'd30',     count(*) filter (where created_at >= now() - interval '30 days'),
        'by_failure', coalesce((
          select jsonb_agg(jsonb_build_object('code', code, 'count', n) order by n desc)
          from (select coalesce(failure_code, 'unknown') code, count(*) n
                  from public.coupon_attempts where outcome = 'failure'
                 group by 1 order by n desc limit 10) f), '[]'::jsonb)
      ) from public.coupon_attempts
    )
  ) into v_coupons;

  -- =========================================================================
  -- Support tickets
  -- =========================================================================
  select jsonb_build_object(
    'open',        count(*) filter (where status = 'open'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'resolved',    count(*) filter (where status = 'resolved'),
    'closed',      count(*) filter (where status = 'closed'),
    'total',       count(*),
    'new_7d',      count(*) filter (where created_at >= now() - interval '7 days')
  ) into v_support
  from public.support_tickets;

  return jsonb_build_object(
    'generated_at', now(),
    'tz',           p_tz,
    'today',        v_today,
    'kpis',         v_kpis,
    'series',       v_series,
    'categories',   v_categories,
    'engagement',   v_engagement,
    'people',       v_people,
    'journey',      v_journey,
    'users',        v_users,
    'revenue',      v_revenue,
    'reports',      v_reports,
    'coupons',      v_coupons,
    'support',      v_support
  );
end;
$fn$;

comment on function public.admin_analytics(text) is
  'Every number the admin dashboard renders, in one jsonb document and one round trip. Read-only. service_role only.';

-- SECURITY DEFINER reading auth.users and every per-user table: nothing that
-- holds a customer session may call this. The admin app reaches it through a
-- server route that has already checked the caller is staff or above.
revoke all on function public.admin_analytics(text) from public;
revoke all on function public.admin_analytics(text) from anon, authenticated;
grant execute on function public.admin_analytics(text) to service_role;
