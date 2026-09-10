import { apiFetch } from './api.client';

/**
 * Coupon types and API calls, mirroring backend/app/schemas/coupon.py.
 *
 * The three concepts the backend keeps apart are kept apart here too,
 * because collapsing them in the UI is how an admin ends up believing an
 * expired coupon has ended the discounts it granted:
 *
 * - a COUPON says when a code may be redeemed and for what,
 * - a REDEMPTION is one customer spending it, once,
 * - an ENTITLEMENT is what that customer gets afterwards, which outlives
 *   the coupon.
 */

export type CouponProduct = 'reports' | 'questions' | 'subscriptions';

export type DiscountDuration =
  | 'first_purchase'
  | '1_month'
  | '3_months'
  | '6_months'
  | '12_months';

/** The admin's stored intent. Four values. */
export type CouponLifecycle = 'draft' | 'published' | 'disabled' | 'archived';

/**
 * What an admin SEES. Six values, because two of them are facts about
 * the clock rather than decisions anybody made: a published coupon reads
 * as Scheduled before its window, Active inside it and Expired after.
 * The backend derives this; nothing stores it.
 */
export type CouponStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'expired'
  | 'disabled'
  | 'archived';

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_percentage: number;
  eligible_products: CouponProduct[];
  discount_duration: DiscountDuration;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  lifecycle: CouponLifecycle;
  status: CouponStatus;
  redemption_count: number;
  /** Null when the coupon is unlimited. */
  redemptions_remaining: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CouponUsage {
  total_redemptions: number;
  released_redemptions: number;
  unique_customers: number;
  by_product: Record<string, number>;
  total_attempts: number;
  successful_attempts: number;
  failed_attempts: number;
  failures_by_reason: Record<string, number>;
  active_entitlements: number;
  /** Every discount given, in minor units (paise). */
  total_discount_amount: number;
}

export interface RedemptionRecord {
  id: string;
  user_id: string;
  coupon_code: string;
  product: CouponProduct;
  item: string | null;
  status: 'reserved' | 'redeemed' | 'released';
  redeemed_at: string | null;
  original_amount: number | null;
  discount_amount: number | null;
  final_amount: number | null;
  currency: string | null;
  discount_percentage: number | null;
  discount_duration: DiscountDuration | null;
  discount_start_at: string | null;
  discount_end_at: string | null;
  discounted_cycles: number | null;
}

export interface CouponDetail {
  coupon: Coupon;
  usage: CouponUsage;
  redemptions: RedemptionRecord[];
}

export interface CouponOptions {
  products: { value: CouponProduct; label: string }[];
  durations: { value: DiscountDuration; label: string }[];
  lifecycles: CouponLifecycle[];
  statuses: CouponStatus[];
  min_discount_percentage: number;
  max_discount_percentage: number;
}

export interface CouponWrite {
  code?: string;
  description?: string | null;
  discount_percentage?: number;
  eligible_products?: CouponProduct[];
  discount_duration?: DiscountDuration;
  starts_at?: string;
  expires_at?: string;
  max_redemptions?: number | null;
  lifecycle?: 'draft' | 'published';
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export const PRODUCT_LABELS: Record<CouponProduct, string> = {
  reports: 'Reports',
  questions: 'Questions',
  subscriptions: 'Subscriptions',
};

export const DURATION_LABELS: Record<DiscountDuration, string> = {
  first_purchase: 'First purchase only',
  '1_month': '1 month',
  '3_months': '3 months',
  '6_months': '6 months',
  '12_months': '12 months',
};

export const STATUS_LABELS: Record<CouponStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  expired: 'Expired',
  disabled: 'Disabled',
  archived: 'Archived',
};

export const STATUS_COLORS: Record<CouponStatus, string> = {
  draft: 'bg-raised text-muted',
  scheduled: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  expired: 'bg-raised text-faint',
  disabled: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  archived: 'bg-raised text-faint',
};

/**
 * Why a coupon submission failed, in words. The keys are the backend's
 * CouponError codes; a cluster of one of them says something different
 * about a campaign, which is the whole reason failures are counted by
 * reason rather than in a single total.
 */
export const FAILURE_LABELS: Record<string, string> = {
  invalid_code: 'Code not found (mistyped or wrong campaign)',
  coupon_inactive: 'Coupon not published',
  coupon_not_started: 'Tried before the start date',
  coupon_expired: 'Tried after the end date',
  product_not_eligible: 'Wrong product',
  usage_limit_reached: 'Usage limit reached',
  already_used_this_month: 'Already used a coupon for that product this month',
  coupon_busy: 'Lost a race for the last redemption',
  coupons_unavailable: 'Coupons were unavailable',
};

/** Paise to rupees, for display. Amounts are always minor units on the wire. */
export function formatAmount(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return '-';
  const major = minorUnits / 100;
  return `₹${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

export function listCoupons(params: {
  status?: string;
  search?: string;
} = {}): Promise<{ coupons: Coupon[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  const qs = query.toString() ? `?${query}` : '';
  return apiFetch<{ coupons: Coupon[]; total: number }>(
    `/coupons/admin/coupons${qs}`,
  );
}

export function getCouponOptions(): Promise<CouponOptions> {
  return apiFetch<CouponOptions>('/coupons/admin/options');
}

export function getCouponDetail(id: string): Promise<CouponDetail> {
  return apiFetch<CouponDetail>(`/coupons/admin/coupons/${id}`);
}

export function createCoupon(body: CouponWrite): Promise<Coupon> {
  return apiFetch<Coupon>('/coupons/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCoupon(id: string, body: CouponWrite): Promise<Coupon> {
  return apiFetch<Coupon>(`/coupons/admin/coupons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function setCouponLifecycle(
  id: string,
  lifecycle: CouponLifecycle,
): Promise<Coupon> {
  return apiFetch<Coupon>(`/coupons/admin/coupons/${id}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify({ lifecycle }),
  });
}

export function deleteCoupon(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/coupons/admin/coupons/${id}`,
    { method: 'DELETE' },
  );
}
