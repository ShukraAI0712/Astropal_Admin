/**
 * The shape of the document `GET /api/analytics` returns, which is the shape
 * `public.admin_analytics()` builds. One file describes it because one call
 * produces it - see sql/001_admin_analytics.sql.
 *
 * Money is in PAISE everywhere, because that is how `payments.amount` is
 * stored. Convert once, at the edge, with `rupees()`.
 */

export type AppRole = 'super_admin' | 'admin' | 'staff' | 'user';

/** Every headline metric carries its own comparison periods. */
export interface Window {
  today: number;
  yesterday: number;
  d7: number;
  prev7: number;
  d30: number;
  prev30: number;
  d180: number;
  d365: number;
  all?: number;
}

export interface SeriesPoint {
  d: string;
  questions: number;
  askers: number;
  active: number;
  new_users: number;
  logins: number;
  login_users: number;
  orders: number;
  paid: number;
  revenue: number;
  reports: number;
}

export interface MemoryCategory {
  category: string;
  today: number;
  d7: number;
  d30: number;
  d365: number;
  total: number;
  users: number;
  sessions: number;
}

export interface AccountRef {
  user_id: string;
  email: string | null;
  first_name: string | null;
  created_at: string | null;
}

/**
 * A person, as every list in the `people` section renders them.
 *
 * `first_name` is resolved in SQL and never null in practice - the fallback
 * chain ends at the email's local part - but it is typed nullable because a
 * row with no email at all is possible and `name()` below has to cope.
 */
export interface Person {
  user_id: string;
  first_name: string | null;
  full_name: string | null;
  email: string | null;
  plan: string | null;
  stage: JourneyStage | null;
}

export type JourneyStage =
  | 'Only signed up'
  | 'Made a horoscope'
  | 'Asked 1-5'
  | 'Asked more than 5'
  | 'Came back after 5+'
  | 'Paying';

/** The order the stages happen in. Used for colour and for sorting. */
export const STAGE_ORDER: JourneyStage[] = [
  'Only signed up',
  'Made a horoscope',
  'Asked 1-5',
  'Asked more than 5',
  'Came back after 5+',
  'Paying',
];

export interface LivePerson extends Person {
  last_seen: string;
  seconds_ago: number;
  doing: string | null;
  questions_today: number;
  is_new: boolean;
}

export interface ActivePerson extends Person {
  questions: number;
  kundalis: number;
  reports: number;
  orders: number;
  is_new: boolean;
  doing: string | null;
  last_seen: string | null;
}

export interface SignupPerson extends Person {
  signed_up: string;
  kundalis: number;
  questions: number;
  last_seen: string | null;
}

export interface SignedInPerson extends Person {
  logins: number;
  signed_up: string | null;
  is_new: boolean;
  questions: number;
  last_seen: string | null;
}

export interface StalledPerson extends Person {
  signed_up: string;
  days_since: number;
  kundalis: number;
  questions: number;
  last_active: string | null;
}

/** One step of the journey funnel, over one signup cohort. */
export interface JourneyWindow {
  days: number | null;
  signed_up: number;
  made_kundali: number;
  asked_any: number;
  asked_over_5: number;
  returned_after: number;
  paid: number;
  queued_report: number;
  /** Both are zero while the funnel is a chain. See ANALYTICS.md. */
  asked_without_kundali: number;
  paid_without_asking: number;
}

export type JourneyRange = 'd30' | 'd90' | 'd365' | 'all';

export const JOURNEY_RANGE_LABELS: Record<JourneyRange, string> = {
  d30: 'Signed up in the last 30 days',
  d90: 'Signed up in the last 90 days',
  d365: 'Signed up in the last year',
  all: 'Every account, ever',
};

/**
 * The five steps, in order, from one cohort's counts.
 *
 * This lives here rather than in either screen so the Overview's summary and
 * the Journey screen cannot end up drawing two different funnels. Adding a
 * step means editing one array.
 *
 * Payment is not a sixth step. It is a different question - one paid account
 * out of four hundred and fifty-seven is a pricing story, not a leak in the
 * activation path - and stapling it on the end would make every other step
 * look like a rounding error.
 */
export function funnelSteps(w: JourneyWindow) {
  return [
    {
      key: 'signed_up',
      label: 'Created an account',
      value: w.signed_up,
      hint: 'Everyone in this cohort.',
    },
    {
      key: 'kundali',
      label: 'Made a horoscope',
      value: w.made_kundali,
      hint: 'At least one kundali on the account.',
    },
    {
      key: 'asked',
      label: 'Asked a question',
      value: w.asked_any,
      hint: 'Sent at least one chat message.',
    },
    {
      key: 'asked_6',
      label: 'Asked more than 5',
      value: w.asked_over_5,
      hint: 'Six or more questions, ever.',
    },
    {
      key: 'returned',
      label: 'Came back after that',
      value: w.returned_after,
      hint: 'Active again on a later day than the one they asked their sixth question on.',
    },
  ];
}

export interface Analytics {
  generated_at: string;
  tz: string;
  today: string;
  caller_role: AppRole;
  cached: boolean;
  stale?: boolean;
  cache_age_seconds: number;

  kpis: {
    questions: Window;
    askers: Window;
    active_users: Window;
    new_users: Window;
    logins: Window;
    revenue: Window;
    orders: Window;
    reports: Window;
  };

  series: { daily: SeriesPoint[]; monthly: SeriesPoint[] };

  categories: {
    memories: MemoryCategory[];
    memories_by_kind: { kind: string; count: number }[];
    memories_monthly: { month: string; category: string; count: number }[];
    life_events: { category: string; count: number; charts: number }[];
    coverage: {
      sessions_with_memory: number;
      sessions_total: number;
      memories_total: number;
      first_memory_at: string | null;
    };
  };

  engagement: {
    today_by_user: { user_id: string; email: string | null; questions: number; plan: string | null }[];
    top_askers_30d: {
      user_id: string; email: string | null; questions: number;
      plan: string | null; days_active: number;
    }[];
    distribution_30d: {
      q1: number; q2_5: number; q6_20: number; q21_50: number; q51plus: number;
      median: number; mean: number;
    };
    chat_sessions: {
      today: number; d7: number; d30: number; all: number;
      avg_questions_per_session: number;
    };
    quota_questions: { today: number; d7: number; d30: number; all: number };
  };

  /** The names behind today's numbers. */
  people: {
    live: { window_minutes: number; count: number; list: LivePerson[] };
    today: {
      new_signups: SignupPerson[];
      signed_in: SignedInPerson[];
      active: ActivePerson[];
    };
  };

  /** Signed up -> horoscope -> asked -> kept asking -> came back. */
  journey: {
    windows: Record<JourneyRange, JourneyWindow>;
    timing: {
      minutes_to_kundali: number | null;
      minutes_to_first_question: number | null;
      minutes_kundali_to_question: number | null;
      minutes_to_sixth_question: number | null;
      median_questions_of_askers: number;
      median_active_days_of_returners: number;
    };
    stages: Partial<Record<JourneyStage, number>>;
    monthly: {
      month: string; signed_up: number; made_kundali: number;
      asked_any: number; asked_over_5: number; returned_after: number;
    }[];
    stalled: Record<
      'no_kundali' | 'kundali_no_question' | 'asked_under_6' | 'no_return',
      { count: number; list: StalledPerson[] }
    >;
  };

  users: {
    total: number;
    by_plan: Record<string, number>;
    by_role: Record<string, number>;
    marketing_consent: number;
    whatsapp_connected: number;
    onboarding_incomplete: number;
    ghosts: { count: number; list: (AccountRef & { days_since: number })[] };
    never_returned: { count: number; list: (AccountRef & { last_sign_in_at: string | null })[] };
    logged_in_today: {
      user_id: string; email: string | null; first_name: string | null;
      logins: number; plan: string | null; signed_up: string | null; is_new: boolean;
    }[];
    returning: Record<'d7' | 'd30' | 'd180', { active: number; multi_day: number; rate: number }>;
    today_split: { new: number; returning: number };
    cohorts: { week: string; size: number; w1: number; w2: number; w3: number; w4: number }[];
    lifecycle: {
      active_7d: number; active_30d: number;
      dormant_30_90: number; dormant_90: number; never_active: number;
      days_1: number; days_2_3: number; days_4_7: number; days_8plus: number;
    };
  };

  revenue: {
    funnel: {
      d7: FunnelSlice; d30: FunnelSlice; d365: FunnelSlice; all: FunnelSlice;
      abandoned: number;
    };
    by_item: {
      item: string; created: number; paid: number; failed: number;
      revenue: number; buyers: number;
    }[];
    failures: { reason: string; count: number }[];
    customers: { paying: number; repeat: number; lifetime_avg: number; lifetime_max: number };
    top_customers: {
      user_id: string; email: string | null; orders: number;
      spend: number; plan: string | null;
    }[];
    recent: {
      created_at: string; paid_at: string | null; email: string | null;
      item: string; amount: number; original_amount: number | null;
      discount_amount: number | null; status: string;
      failure_reason: string | null; coupon_code: string | null;
      settled_via: string | null;
    }[];
    subscriptions: {
      total: number; active: number; cancelled: number;
      by_plan: Record<string, number>;
    };
    plan_churn: { cancelled_30d: number; expiring_7d: number; auto_renew_on: number };
  };

  reports: {
    by_type: {
      type: string; today: number; d7: number; d30: number;
      total: number; failed: number; users: number;
    }[];
    queue: {
      pending: number; failed: number; completed: number;
      success_rate: number; avg_seconds: number;
    };
    failures: {
      report_type: string; last_error: string | null;
      attempt_count: number; updated_at: string;
    }[];
    saved: Record<string, number>;
  };

  coupons: {
    total: number;
    active: number;
    redemptions: { live: number; released: number; discount_given: number };
    attempts: {
      total: number; success: number; failure: number; d30: number;
      by_failure: { code: string; count: number }[];
    };
  };

  support: {
    open: number; in_progress: number; resolved: number;
    closed: number; total: number; new_7d: number;
  };
}

export interface FunnelSlice {
  created: number;
  paid: number;
  failed: number;
  open: number;
}

// ------------------------------------------------------------------ //
//  Formatting                                                         //
// ------------------------------------------------------------------ //

/** Paise -> rupees. The one place the conversion happens. */
export function rupees(paise: number): number {
  return Math.round(paise / 100);
}

/** "12,450" - the one number format in this dashboard. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('en-IN');
}

/** "Rs 1,20,000" from paise. */
export function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '-';
  return `₹${rupees(paise).toLocaleString('en-IN')}`;
}

/**
 * The change against the comparison period, as a percentage.
 *
 * Returns null when the previous period was zero: "up 100%" from nothing is
 * not a fact about growth, and a dash is the honest rendering.
 */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "15 Sep" - compact axis and row labels. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!d) {
    return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('en-IN', {
      month: 'short',
      year: '2-digit',
    });
  }
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Turn a snake_case identifier into a readable label. */
export function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * What to call somebody.
 *
 * SQL has already tried the identity provider's name, the primary kundali and
 * the email's local part, so this only has to handle the account with no email
 * either. It never prints a raw uuid as if it were a name.
 */
export function name(p: { first_name?: string | null; email?: string | null; user_id: string }): string {
  if (p.first_name) return p.first_name;
  if (p.email) return p.email.split('@')[0];
  return p.user_id.slice(0, 8);
}

/** The letter for an avatar chip. */
export function initial(p: { first_name?: string | null; email?: string | null; user_id: string }): string {
  return name(p).charAt(0).toUpperCase();
}

/**
 * "4 min ago", "2 hours ago".
 *
 * Seconds are never printed. The document behind them is cached for up to a
 * minute, so "12 seconds ago" would be a precision the number does not have.
 */
export function ago(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  const m = Math.round(seconds / 60);
  if (m < 1) return 'just now';
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h === 1) return '1 hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Seconds between a timestamp and now, for a `last_seen` that carries no delta. */
export function secondsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

/**
 * A duration given in minutes, printed in whichever unit makes it legible.
 *
 * The journey timings are all sub-hour today, which is the finding rather than
 * an accident, so minutes keep their decimal and only longer spans round up
 * into hours and days.
 */
export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '-';
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  if (minutes < 90) return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} hours`;
  return `${Math.round(h / 24)} days`;
}

/** "62%" of a whole, with the zero-denominator case spelled out rather than NaN. */
export function pct(part: number, whole: number): string {
  if (!whole) return '-';
  return `${Math.round((part / whole) * 100)}%`;
}

// ------------------------------------------------------------------ //
//  Ranges                                                             //
// ------------------------------------------------------------------ //

export type Range = '7d' | '30d' | '90d' | '6m' | '1y';

/**
 * The points a range selector should draw.
 *
 * Short ranges read from the daily series and long ones from the monthly
 * series, which is why the analytics function returns both: a year of daily
 * points is 365 unreadable pixels-wide ticks, and a week of monthly points is
 * one bar. Neither series is recomputed when the range changes - the whole
 * document is already in the browser, so switching range is a slice.
 */
export function sliceSeries(a: Analytics, range: Range) {
  const monthly = range === '6m' || range === '1y';
  const source = monthly ? a.series.monthly : a.series.daily;
  const n = { '7d': 7, '30d': 30, '90d': 90, '6m': 6, '1y': 12 }[range];
  const points = source.slice(-n);
  return { points, monthly, labels: points.map((p) => shortDate(p.d)) };
}

export const RANGE_LABELS: Record<Range, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '6m': 'last 6 months',
  '1y': 'last 12 months',
};
