'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  DURATION_LABELS,
  PRODUCT_LABELS,
  createCoupon,
  updateCoupon,
  type Coupon,
  type CouponOptions,
  type CouponProduct,
  type CouponWrite,
  type DiscountDuration,
} from '@/lib/coupons';
import { ApiError } from '@/lib/api.client';

/**
 * Create or edit one coupon.
 *
 * Two things this form deliberately does NOT do, both because the
 * backend would only have to undo them:
 *
 * - It never touches the code the admin typed. No upper-casing, no
 *   trimming inside the value, no punctuation cleanup. ASTRO20 and
 *   astro20 are different coupons, and a form that "helpfully" folds the
 *   case creates a code nobody can redeem because it is not the one that
 *   was printed in the email.
 * - It never offers a discount above the ceiling the backend serves in
 *   `options.max_discount_percentage`. Offering 100 and then rejecting
 *   it is a worse experience than not offering it.
 */

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Back to an absolute instant. The admin types local time; the coupon stores UTC. */
function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function defaultStart(): string {
  return toLocalInput(new Date().toISOString());
}

function defaultEnd(): string {
  const end = new Date();
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 0, 0);
  return toLocalInput(end.toISOString());
}

export function CouponForm({
  options,
  existing,
  onSaved,
  onCancel,
}: {
  options: CouponOptions;
  /** Editing an existing coupon, or null to create one. */
  existing?: Coupon | null;
  onSaved: (coupon: Coupon) => void;
  onCancel: () => void;
}) {
  const editing = !!existing;
  const locked = editing && existing!.redemption_count > 0;

  const [code, setCode] = useState(existing?.code ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [percentage, setPercentage] = useState(
    String(existing?.discount_percentage ?? 20),
  );
  const [products, setProducts] = useState<CouponProduct[]>(
    existing?.eligible_products ?? [],
  );
  const [duration, setDuration] = useState<DiscountDuration>(
    existing?.discount_duration ?? 'first_purchase',
  );
  const [startsAt, setStartsAt] = useState(
    existing ? toLocalInput(existing.starts_at) : defaultStart(),
  );
  const [expiresAt, setExpiresAt] = useState(
    existing ? toLocalInput(existing.expires_at) : defaultEnd(),
  );
  const [maxRedemptions, setMaxRedemptions] = useState(
    existing?.max_redemptions != null ? String(existing.max_redemptions) : '',
  );
  const [publishNow, setPublishNow] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleProduct(product: CouponProduct) {
    setProducts((current) =>
      current.includes(product)
        ? current.filter((p) => p !== product)
        : [...current, product],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!code) {
      setError('Enter a coupon code.');
      return;
    }
    if (products.length === 0) {
      // An empty scope is not "applies to everything" - it is a mistake,
      // and the backend refuses it for exactly that reason.
      setError('Pick at least one product this coupon applies to.');
      return;
    }
    const percent = Number(percentage);
    if (
      !Number.isInteger(percent) ||
      percent < options.min_discount_percentage ||
      percent > options.max_discount_percentage
    ) {
      setError(
        `Discount must be a whole number between ${options.min_discount_percentage}% and ${options.max_discount_percentage}%.`,
      );
      return;
    }
    if (!startsAt || !expiresAt) {
      setError('Set both a start and an end date.');
      return;
    }
    if (new Date(expiresAt) <= new Date(startsAt)) {
      setError('The end date must be after the start date.');
      return;
    }

    const body: CouponWrite = {
      // Sent exactly as typed.
      code,
      description: description.trim() || null,
      discount_percentage: percent,
      eligible_products: products,
      discount_duration: duration,
      starts_at: fromLocalInput(startsAt),
      expires_at: fromLocalInput(expiresAt),
      max_redemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
    };

    setSaving(true);
    try {
      const saved = editing
        ? await updateCoupon(existing!.id, locked ? { ...body, code: undefined } : body)
        : await createCoupon({ ...body, lifecycle: publishNow ? 'published' : 'draft' });
      onSaved(saved);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not save the coupon.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-5 py-5">
      <Field
        label="Coupon code"
        hint="Case sensitive and matched exactly. ASTRO20 and astro20 are different coupons."
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={locked}
          // The keyboard must not capitalise and the browser must not
          // autocorrect: the value is stored byte for byte.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ASTRO20"
          className="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint disabled:opacity-60"
        />
        {locked && (
          <p className="mt-1 text-xs text-faint">
            This coupon has been redeemed, so its code can no longer be
            changed. Disable it and create a new one instead.
          </p>
        )}
      </Field>

      <Field label="Internal note" hint="Admins only. Never shown to a customer.">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Diwali retargeting, third send"
          className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
        />
      </Field>

      <Field
        label="Discount"
        hint={`Percentage off, ${options.min_discount_percentage} to ${options.max_discount_percentage}. There is no 100% coupon.`}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={options.min_discount_percentage}
            max={options.max_discount_percentage}
            step={1}
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            className="w-24 rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
          />
          <span className="text-sm text-muted">%</span>
        </div>
      </Field>

      <Field
        label="Eligible products"
        hint="Checked at redemption against what is being bought. A subscription discount never reaches a report bought outside the plan."
      >
        <div className="flex flex-wrap gap-2">
          {options.products.map((product) => {
            const selected = products.includes(product.value);
            return (
              <button
                key={product.value}
                type="button"
                onClick={() => toggleProduct(product.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-solid text-inverse'
                    : 'bg-raised text-muted hover:bg-line'
                }`}
              >
                {PRODUCT_LABELS[product.value] ?? product.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Discount duration"
        hint="How long the discount lasts AFTER a successful redemption. Nothing to do with the end date below."
      >
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value as DiscountDuration)}
          className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
        >
          {options.durations.map((d) => (
            <option key={d.value} value={d.value}>
              {DURATION_LABELS[d.value] ?? d.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Redeemable from">
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
          />
        </Field>
        <Field label="Redeemable until">
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
          />
        </Field>
      </div>

      <p className="rounded-md bg-raised border border-line px-3 py-2 text-xs text-muted">
        These dates control when a NEW customer can redeem the code. They do
        not end a discount somebody has already been given: a coupon that
        expires on 30 September, redeemed on the 20th with a 3 month
        duration, keeps discounting that customer until 20 December.
      </p>

      <Field
        label="Maximum redemptions"
        hint="Leave blank for unlimited. Enforced atomically, so two simultaneous checkouts cannot both take the last one."
      >
        <input
          type="number"
          min={1}
          value={maxRedemptions}
          onChange={(e) => setMaxRedemptions(e.target.value)}
          placeholder="Unlimited"
          className="w-40 rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
        />
      </Field>

      {!editing && (
        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={publishNow}
            onChange={(e) => setPublishNow(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Publish immediately. Leave unticked to save it as a draft, which
            nobody can redeem until you publish it.
          </span>
        </label>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-solid px-4 py-2 text-sm font-medium text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? 'Save changes' : 'Create coupon'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-raised"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      {children}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
