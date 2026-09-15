-- ---------------------------------------------------------------------------
-- 002_admin_dashboard_gate.sql
--
-- Lets the dashboard reach its analytics with the signed-in admin's OWN token,
-- so the app needs no service-role key.
--
-- `admin_analytics()` stays exactly as it was: SECURITY DEFINER, granted to
-- `service_role` alone, and reachable by nothing that holds a customer
-- session. What changes is that a second, tiny function sits in front of it
-- and is the only thing `authenticated` may call:
--
--     browser JWT -> admin_dashboard() -> [role check] -> admin_analytics()
--
-- `admin_dashboard` is SECURITY DEFINER too, so it runs as the owner and can
-- call `admin_analytics` regardless of what the caller is granted. That is the
-- whole mechanism: the privilege is lent for exactly one call, and only after
-- the caller has been shown to be staff or above.
--
-- Keeping the gate in its own function rather than inlining it has a point -
-- it is three dozen lines that can be read and audited on their own, instead
-- of a check buried at the top of six hundred lines of aggregation.
--
-- THE TRADE-OFF, WRITTEN DOWN SO NOBODY REDISCOVERS IT
--
-- Before this file, the analytics were unreachable from any browser, because
-- only the service role could execute them. Now a staff member's ordinary
-- session on astropal.app can reach this RPC directly - the same class of
-- exposure `require_admin_origin` was added to close on the FastAPI admin
-- routes (see AskDisha CLAUDE.md, "Any new admin route needs BOTH"). PostgREST
-- has no equivalent origin control, so the role check is the only gate here.
--
-- What that costs, concretely: script running in a staff member's browser on
-- astropal.app could read this document, which contains customer emails and
-- revenue. It is read-only - there is no write path in any of this - and it
-- requires the victim to already be staff or above.
--
-- To close it again, set SUPABASE_SERVICE_ROLE_KEY in the admin app's Vercel
-- project and run:
--
--     revoke execute on function public.admin_dashboard(text) from authenticated;
--
-- The route handler falls back to the service-role key whenever it is present,
-- so that revoke is the entire change. Nothing else has to move.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

create or replace function public.admin_dashboard(p_tz text default 'Asia/Kolkata')
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_claims  text := current_setting('request.jwt.claims', true);
  v_jwt     text := coalesce(nullif(v_claims, '')::jsonb ->> 'role', '');
  v_uid     uuid := auth.uid();
  v_role    text;
begin
  if v_claims is null or v_claims = '' then
    -- A direct database connection: psql, the SQL editor, a migration. It can
    -- already read every table this function touches, so gating it would add
    -- nothing but a confusing error in the one place people debug from.
    v_role := 'super_admin';

  elsif v_jwt = 'service_role' then
    -- The server calling with the service key, which is the stronger posture
    -- and stays supported. The caller's own role is unknown and unneeded here;
    -- the route handler has already checked it.
    v_role := 'super_admin';

  else
    if v_uid is null then
      raise exception 'admin_dashboard: not authenticated'
        using errcode = '42501';
    end if;

    select coalesce(up.app_role, 'user')
      into v_role
      from public.user_profiles up
     where up.user_id = v_uid::text;

    v_role := coalesce(v_role, 'user');

    -- The same three roles the backend's require_staff admits. `staff` is
    -- deliberately included and deliberately NOT privileged elsewhere: staff
    -- may read this dashboard and still pays for premium reports like anyone.
    if v_role not in ('staff', 'admin', 'super_admin') then
      raise exception 'admin_dashboard: % is not permitted', v_role
        using errcode = '42501';
    end if;
  end if;

  -- admin_analytics() builds its working sets as ON COMMIT DROP temp tables,
  -- so a SECOND call inside the same transaction fails on "relation _q already
  -- exists". PostgREST gives each request its own transaction, so production
  -- never hits it - but anyone calling the function twice in one SQL editor
  -- statement does, immediately, and the error points at a line that is not
  -- the problem. Clearing the slate here costs nothing and makes the entry
  -- point safe to call as many times as you like.
  drop table if exists
    pg_temp._q, pg_temp._act, pg_temp._mem, pg_temp._logins,
    pg_temp._accounts, pg_temp._ghosts, pg_temp._never_returned;

  -- The caller's role travels with the document, so the app does not need a
  -- second query to decide whether to show the edit controls.
  return public.admin_analytics(p_tz) || jsonb_build_object('caller_role', v_role);
end;
$fn$;

comment on function public.admin_dashboard(text) is
  'Role-gated entry point to admin_analytics(). The only analytics function authenticated may execute. See sql/002_admin_dashboard_gate.sql for the trade-off this accepts.';

revoke all on function public.admin_dashboard(text) from public;
revoke all on function public.admin_dashboard(text) from anon;
grant execute on function public.admin_dashboard(text) to authenticated;
grant execute on function public.admin_dashboard(text) to service_role;
