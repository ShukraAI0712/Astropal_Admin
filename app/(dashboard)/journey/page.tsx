'use client';

import { useMemo, useState } from 'react';
import {
  JOURNEY_RANGE_LABELS, STAGE_ORDER, duration, funnelSteps, name as personName,
  num, pct, shortDate, type JourneyRange, type StalledPerson,
} from '@/lib/analytics';
import { useAnalytics } from '@/lib/analytics-context';
import {
  Caveat, CopyEmails, Empty, Panel, PersonRow, Pill, PLAN_COLORS, StatCard,
} from '@/components/ui';
import { BarList, Funnel, SERIES, TimeSeries } from '@/components/charts';

/**
 * Journey - what happens to an account between signing up and coming back.
 *
 * The Users screen answers "how many of them are still here". This one answers
 * "where do we lose them", which is a different question with a different
 * shape: one cohort, followed forward through five steps, with the people who
 * stopped at each step listed underneath by name.
 *
 * The cohort rule is the thing to understand before reading anything here.
 * Every step is measured over the same set of accounts, chosen by when they
 * SIGNED UP - so the 30-day window necessarily understates every step after
 * the first, because an account that signed up on Tuesday has not had time to
 * ask six questions and come back. The all-time window is the one that has had
 * time; the short windows are for spotting a change.
 */

/** The four places an account can stop, in the order they happen. */
const LEAKS = [
  {
    key: 'no_kundali' as const,
    title: 'Signed up, never made a horoscope',
    why: 'They created the account and left before the one thing the product is built around.',
  },
  {
    key: 'kundali_no_question' as const,
    title: 'Made a horoscope, never asked anything',
    why: 'They saw their chart and did not start a conversation. The biggest single group.',
  },
  {
    key: 'asked_under_6' as const,
    title: 'Asked between one and five questions',
    why: 'They tried it. Something in the first five answers did not land hard enough to make a sixth.',
  },
  {
    key: 'no_return' as const,
    title: 'Asked more than five, then never came back',
    why: 'These are the painful ones: they got the whole experience and still did not return.',
  },
];

function StalledList({
  title,
  why,
  count,
  list,
}: {
  title: string;
  why: string;
  count: number;
  list: StalledPerson[];
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? list : list.slice(0, 6);

  return (
    <Panel
      title={`${title} (${num(count)})`}
      subtitle={why}
      action={<CopyEmails emails={list.map((p) => p.email)} />}
      bare
    >
      {list.length === 0 ? (
        <Empty>Nobody is stuck here.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <PersonRow
                key={p.user_id}
                person={p}
                meta={`${p.email ?? personName(p)} · joined ${p.days_since} day${p.days_since === 1 ? '' : 's'} ago`}
                right={
                  <>
                    <Pill className={PLAN_COLORS[p.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                      {p.plan ?? 'basic'}
                    </Pill>
                    <span className="text-xs text-faint tabular-nums">
                      {p.questions > 0 ? `${p.questions} q` : p.kundalis > 0 ? `${p.kundalis} chart` : '-'}
                    </span>
                  </>
                }
              />
            ))}
          </ul>

          {list.length > 6 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="w-full border-t border-line px-5 py-3 text-xs font-medium text-muted transition-colors hover:bg-raised"
            >
              {open
                ? 'Show fewer'
                : `Show all ${list.length}${count > list.length ? ` listed (of ${num(count)})` : ''}`}
            </button>
          )}

          {open && count > list.length && (
            <p className="border-t border-line px-5 py-3 text-xs text-faint">
              Showing the {list.length} most recent of {num(count)}. The rest are older than
              this list goes.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

export default function JourneyPage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<JourneyRange>('all');

  const monthly = useMemo(() => data?.journey.monthly ?? [], [data]);

  if (!data) return null;

  const j = data.journey;
  const w = j.windows[range];
  const steps = funnelSteps(w);
  const t = j.timing;

  // The one place the funnel could stop being a chain. Both counts are zero
  // while the product requires a horoscope before a chat; if that changes,
  // this says so rather than the funnel quietly drawing a lie.
  const broken = w.asked_without_kundali > 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">User journey</h1>
        <p className="mt-1 text-sm text-muted">
          One cohort of accounts, followed forward: signed up, made a horoscope, asked
          something, kept asking, came back. Every step below is the same set of people.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface p-0.5">
          {(Object.keys(JOURNEY_RANGE_LABELS) as JourneyRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r ? 'bg-solid text-inverse' : 'text-muted hover:bg-raised'
              }`}
            >
              {r === 'all' ? 'All time' : r === 'd365' ? '1 year' : `${r.slice(1)} days`}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">{JOURNEY_RANGE_LABELS[range]}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Reach a horoscope"
          value={pct(w.made_kundali, w.signed_up)}
          sub={`${num(w.made_kundali)} of ${num(w.signed_up)}`}
        />
        <StatCard
          label="Ask anything"
          value={pct(w.asked_any, w.signed_up)}
          sub={`${num(w.asked_any)} of ${num(w.signed_up)}`}
        />
        <StatCard
          label="Ask more than 5"
          value={pct(w.asked_over_5, w.signed_up)}
          sub={`${num(w.asked_over_5)} of ${num(w.signed_up)}`}
        />
        <StatCard
          label="Come back after that"
          value={pct(w.returned_after, w.asked_over_5)}
          sub={`${num(w.returned_after)} of the ${num(w.asked_over_5)} who asked 6+`}
          tone={
            w.asked_over_5 && w.returned_after / w.asked_over_5 < 0.3 ? 'warning' : undefined
          }
        />
      </section>

      <Panel
        title="The funnel"
        subtitle={`${JOURNEY_RANGE_LABELS[range]}. Each bar is measured against the first.`}
      >
        <Funnel steps={steps} />

        <div className="mt-6 space-y-3">
          {range !== 'all' && (
            <Caveat>
              Every step after the first is <strong>understated</strong> in a short window,
              and not by a little: an account that signed up this week has not had the
              chance to ask six questions and come back on a later day. Read the short
              windows against each other to spot a change, and read{' '}
              <strong>all time</strong> for the real shape.
            </Caveat>
          )}
          {broken && (
            <Caveat>
              <strong>{num(w.asked_without_kundali)} accounts asked a question without a
              horoscope.</strong> The funnel above assumes the steps are nested, which
              they no longer are - the &ldquo;asked&rdquo; bar is not a subset of the
              &ldquo;horoscope&rdquo; bar. Worth a look before acting on these numbers.
            </Caveat>
          )}
          {w.paid > 0 && (
            <p className="text-xs text-muted">
              {num(w.paid)} of these accounts {w.paid === 1 ? 'has' : 'have'} paid for
              something, and {num(w.queued_report)}{' '}
              {w.queued_report === 1 ? 'has' : 'have'} asked for a report. Payment is not a
              step in the funnel above - see the Revenue screen.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="How fast it happens"
          subtitle="Median time from signing up, across every account that reached the step."
        >
          <dl className="space-y-3">
            {[
              ['Signed up → horoscope', t.minutes_to_kundali],
              ['Horoscope → first question', t.minutes_kundali_to_question],
              ['Signed up → first question', t.minutes_to_first_question],
              ['Signed up → sixth question', t.minutes_to_sixth_question],
            ].map(([label, mins]) => (
              <div key={label as string} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-sm font-medium text-ink tabular-nums">
                  {duration(mins as number | null)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <Caveat>
              The median account does <strong>all of it inside the first session</strong> -
              horoscope, first question and sixth question in the first quarter of an hour.
              Nothing here is a slow funnel someone works through over days: an account
              that leaves the first sitting without asking rarely returns to start.
            </Caveat>
          </div>
        </Panel>

        <Panel
          title="Where every account stands"
          subtitle="Each account counted once, by the furthest step it reached. All time."
        >
          <BarList
            rows={STAGE_ORDER.filter((s) => j.stages[s] !== undefined).map((s) => ({
              label: s,
              value: j.stages[s] ?? 0,
              sub: pct(j.stages[s] ?? 0, data.users.total),
            }))}
          />
          <p className="mt-4 text-xs text-muted">
            These do not overlap, unlike the funnel above: someone who asked more than five
            questions and came back appears only under &ldquo;came back&rdquo;. The median
            account that asks at all asks {num(t.median_questions_of_askers)} questions, and
            the ones who come back are active on{' '}
            {num(t.median_active_days_of_returners)} separate days.
          </p>
        </Panel>
      </div>

      <Panel
        title="Is the funnel getting better?"
        subtitle="By the month each cohort signed up. A change to onboarding shows up here as a step that moved."
      >
        <TimeSeries
          labels={monthly.map((m) => shortDate(m.month))}
          height={240}
          lines={[
            { key: 'signed_up', label: 'Signed up', values: monthly.map((m) => m.signed_up), color: SERIES[1] },
            { key: 'kundali', label: 'Made a horoscope', values: monthly.map((m) => m.made_kundali), color: SERIES[2] },
            { key: 'asked', label: 'Asked something', values: monthly.map((m) => m.asked_any), color: SERIES[0] },
            { key: 'asked6', label: 'Asked 6+', values: monthly.map((m) => m.asked_over_5), color: SERIES[6] },
            { key: 'returned', label: 'Came back after', values: monthly.map((m) => m.returned_after), color: SERIES[5] },
          ]}
        />
        <div className="mt-4">
          <Caveat>
            Counts, not rates, so the lines move with how many people signed up that month.
            The shape to watch is the <strong>gap between them</strong> - signups climbing
            while the lower lines stay flat is acquisition that is not converting. The
            newest month is still filling, and its lower steps have had the least time.
          </Caveat>
        </div>
      </Panel>

      <div>
        <h2 className="text-sm font-semibold text-ink">Where they stopped</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          The four leaks, as people rather than percentages, newest first. These are all
          time - the email is the point of the list.
        </p>
        <div className="space-y-6">
          {LEAKS.map((l) => (
            <StalledList
              key={l.key}
              title={l.title}
              why={l.why}
              count={j.stalled[l.key].count}
              list={j.stalled[l.key].list}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
