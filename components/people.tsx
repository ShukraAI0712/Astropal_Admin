'use client';

import { useMemo, useState } from 'react';
import { Circle } from 'lucide-react';
import {
  ago, name as personName, num, secondsSince,
  type ActivePerson, type Analytics, type LivePerson,
  type SignedInPerson, type SignupPerson,
} from '@/lib/analytics';
import {
  CopyEmails, Empty, Filter, PersonRow, Pill, PLAN_COLORS, Sheet, StagePill,
} from '@/components/ui';

/**
 * The people behind today's tiles, full screen.
 *
 * Five views over four lists, all of them read from the one analytics document
 * that is already in the browser - opening a sheet costs no request and no
 * query. That is why these lists are built in `admin_analytics()` alongside
 * the counts rather than fetched when a tile is tapped: the alternative is a
 * second endpoint whose definition of "active today" would eventually drift
 * from the tile's.
 *
 * `questions` is deliberately not its own list. It is the active list filtered
 * to the people who asked something, so the name on the Questions sheet and
 * the name on the Active sheet are guaranteed to be the same person counted
 * the same way.
 */

export type SheetKind = 'live' | 'active' | 'new' | 'signed_in' | 'questions';

const TITLES: Record<SheetKind, string> = {
  live: 'Live right now',
  active: 'Active today',
  new: 'New accounts today',
  signed_in: 'Signed in today',
  questions: 'Asked something today',
};

function matches(p: { first_name?: string | null; full_name?: string | null; email?: string | null }, q: string) {
  const hay = `${p.full_name ?? ''} ${p.first_name ?? ''} ${p.email ?? ''}`.toLowerCase();
  return hay.includes(q.toLowerCase().trim());
}

/** "2 questions · 1 horoscope" - only the things that actually happened. */
function did(p: ActivePerson): string {
  const bits: string[] = [];
  if (p.questions) bits.push(`${p.questions} question${p.questions === 1 ? '' : 's'}`);
  if (p.kundalis) bits.push(`${p.kundalis} horoscope${p.kundalis === 1 ? '' : 's'}`);
  if (p.reports) bits.push(`${p.reports} report${p.reports === 1 ? '' : 's'}`);
  if (p.orders) bits.push(`${p.orders} order${p.orders === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

export function PeopleSheet({
  kind,
  data,
  onClose,
}: {
  kind: SheetKind | null;
  data: Analytics;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    if (!kind) return [];
    const t = data.people.today;
    const source: (LivePerson | ActivePerson | SignupPerson | SignedInPerson)[] =
      kind === 'live' ? data.people.live.list
      : kind === 'new' ? t.new_signups
      : kind === 'signed_in' ? t.signed_in
      : kind === 'questions'
        ? [...t.active].filter((p) => p.questions > 0).sort((a, b) => b.questions - a.questions)
        : t.active;
    return q ? source.filter((p) => matches(p, q)) : source;
  }, [kind, data, q]);

  if (!kind) return null;

  const live = data.people.live;

  const subtitle =
    kind === 'live'
      ? `A signal in the last ${live.window_minutes} minutes - a question, a horoscope, or the app simply being open.`
      : kind === 'new'
        ? 'Accounts created today, and how far each one got.'
        : kind === 'signed_in'
          ? 'New sessions started today. Someone who never signed out is active without appearing here.'
          : kind === 'questions'
            ? 'Everyone who sent at least one chat message today, busiest first.'
            : 'Everyone who did anything we can see today, most recent first.';

  return (
    <Sheet
      open
      onClose={() => { setQ(''); onClose(); }}
      title={`${TITLES[kind]} (${num(rows.length)})`}
      subtitle={subtitle}
      action={<CopyEmails emails={rows.map((p) => p.email)} />}
    >
      <Filter value={q} onChange={setQ} count={rows.length + (q ? 12 : 0)} />

      {rows.length === 0 ? (
        <Empty>
          {q ? `Nobody matches "${q}".` : 'Nobody yet today.'}
        </Empty>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((p) => {
            if (kind === 'live') {
              const l = p as LivePerson;
              return (
                <PersonRow
                  key={p.user_id}
                  person={p}
                  live
                  meta={
                    <span className="inline-flex items-center gap-1.5">
                      <Circle
                        aria-hidden
                        className="h-2 w-2 fill-current"
                        style={{ color: 'var(--status-good)' }}
                      />
                      {l.doing ?? 'Here'} · {ago(l.seconds_ago)}
                    </span>
                  }
                  right={
                    <>
                      {l.is_new && <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">New</Pill>}
                      <StagePill stage={l.stage} />
                    </>
                  }
                />
              );
            }

            if (kind === 'new') {
              const s = p as SignupPerson;
              return (
                <PersonRow
                  key={p.user_id}
                  person={p}
                  meta={`${s.email ?? personName(p)} · joined ${ago(secondsSince(s.signed_up))}`}
                  right={<StagePill stage={s.stage} />}
                />
              );
            }

            if (kind === 'signed_in') {
              const s = p as SignedInPerson;
              return (
                <PersonRow
                  key={p.user_id}
                  person={p}
                  meta={s.email ?? personName(p)}
                  right={
                    <>
                      {s.is_new ? (
                        <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">New</Pill>
                      ) : (
                        <Pill className={PLAN_COLORS[s.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                          {s.plan ?? 'basic'}
                        </Pill>
                      )}
                      <span className="text-xs text-faint tabular-nums">
                        {s.logins} sign-in{s.logins === 1 ? '' : 's'}
                      </span>
                    </>
                  }
                />
              );
            }

            const a = p as ActivePerson;
            const secs = secondsSince(a.last_seen);
            return (
              <PersonRow
                key={p.user_id}
                person={p}
                live={secs !== null && secs <= live.window_minutes * 60}
                meta={did(a) || a.doing || a.email || undefined}
                right={
                  <>
                    {a.is_new && <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">New</Pill>}
                    <span className="text-xs text-faint">{ago(secs)}</span>
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

/**
 * The strip at the top of the Overview: who is on the app at this moment.
 *
 * It renders the first few faces rather than a number, because the point of
 * "live" is that these are individual people you could go and look at, and it
 * degrades to a plain sentence when nobody is on - an empty row of avatars
 * reads like a loading state.
 */
export function LiveStrip({ data, onOpen }: { data: Analytics; onOpen: () => void }) {
  const live = data.people.live;
  const shown = live.list.slice(0, 5);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={live.count === 0}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-5 py-3.5 text-left transition-colors enabled:hover:bg-raised disabled:cursor-default"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {live.count > 0 && (
          <span
            aria-hidden
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ background: 'var(--status-good)' }}
          />
        )}
        <span
          aria-hidden
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ background: live.count > 0 ? 'var(--status-good)' : 'var(--faint)' }}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">
          {live.count === 0
            ? 'Nobody on the app right now'
            : `${live.count} ${live.count === 1 ? 'person is' : 'people are'} on the app right now`}
        </span>
        <span className="mt-0.5 block truncate text-xs text-faint">
          {live.count === 0
            ? `No signal in the last ${live.window_minutes} minutes.`
            : `${shown.map((p) => personName(p)).join(', ')}${live.count > shown.length ? ` and ${live.count - shown.length} more` : ''}`}
        </span>
      </span>

      {/* Overlapping initials, each ringed in the surface colour so the stack
          stays countable. Hidden on a phone, where the names below say it
          better in the width available. */}
      {shown.length > 0 && (
        <span className="hidden shrink-0 -space-x-2 sm:flex">
          {shown.map((p) => (
            <span
              key={p.user_id}
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 bg-raised text-[11px] font-semibold text-ink"
              style={{ borderColor: 'var(--surface)' }}
            >
              {personName(p).charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
