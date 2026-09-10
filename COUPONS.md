# Discount coupons

Percentage discount codes: created here, redeemed in AstroPal, settled by
the same Razorpay path as every other payment.

The backend lives in the AskDisha repo (`backend/app/core/coupons.py`,
`backend/app/services/coupon_service.py`, `backend/app/api/routes/coupons.py`)
and the schema in `backend/migrations/080_discount_coupons.sql`. This
document is the whole feature in one place: what the admin screen does,
what the rules are, and why each one is written the way it is.

---

## 1. The core idea: three concepts, never one

Almost everything below follows from refusing to merge these:

| Concept | Question it answers | Where it lives |
| --- | --- | --- |
| **Coupon validity** | When may this code be redeemed? | `coupons.starts_at` / `expires_at` / `lifecycle` |
| **Coupon eligibility** | What may it be redeemed for? | `coupons.eligible_products` |
| **Discount entitlement** | Having redeemed it, what does this customer get, and for how long? | `coupon_discount_entitlements` |

The third has to survive the first. A code that ran 1 - 30 September and
was redeemed on the 20th with a three month duration keeps discounting
that customer until 20 December. Expiring, disabling or archiving the
coupon stops NEW redemptions and touches nothing that was already
granted.

The failure this prevents is specific and common: one `expires_at` and
one `coupon_active` boolean, and every customer who redeemed in good
faith silently goes back to full price the day the campaign ends.

So the system always answers two separate questions:

- Can this coupon be redeemed right now, by this customer, for this
  product?
- Does this customer already have an active discount for this product?

---

## 2. The admin screen

`admin.astropal.app/coupons`. Reading the list needs `admin`; creating,
editing, disabling, archiving and deleting need `super_admin`. Every
route also carries `require_admin_origin`, so an admin's ordinary session
on `astropal.app` cannot be driven into a coupon endpoint by injected
script.

### The list

Code, discount, eligible products, discount duration, the redemption
window, usage against the maximum, and status. Filter by status, search
by code or internal note.

### Status

Six values. Four are stored (`lifecycle`) and two are the clock:

| Status | Means |
| --- | --- |
| **Draft** | Created but never published. Nobody can redeem it. |
| **Scheduled** | Published, but `starts_at` has not arrived. |
| **Active** | Published and inside its window. |
| **Expired** | Published, but `expires_at` has passed. |
| **Disabled** | Deliberately stopped. Existing discounts keep running. |
| **Archived** | Retired for good, history intact. |

`lifecycle` stores only `draft` / `published` / `disabled` / `archived`.
Scheduled, Active and Expired are the same stored value seen through a
clock, which is why a coupon starts and expires with nothing having to
run.

### Creating a coupon

- **Code** - stored and matched EXACTLY as typed. See section 3.
- **Internal note** - admins only, never shown to a customer.
- **Discount** - a whole percentage, 1 to 90. There is no 100% coupon;
  see section 4.
- **Eligible products** - at least one of Reports, Questions,
  Subscriptions. An empty scope is refused rather than treated as "all".
- **Discount duration** - first purchase only, or 1 / 3 / 6 / 12 months.
  This is how long the discount lasts AFTER redemption and has nothing to
  do with the dates below.
- **Redeemable from / until** - when a new customer may redeem the code.
- **Maximum redemptions** - optional. Enforced atomically.

New coupons save as drafts unless "publish immediately" is ticked, so a
half-typed campaign is never live.

### Editing

Everything can be changed except the code once anybody has redeemed it.
That refusal is not pedantry: the code is printed in emails and typed by
customers, and it is denormalised onto every redemption record so the
audit trail survives. Rename a live campaign and you break the codes
people are holding while rewriting history.

Nothing an edit changes reaches an existing entitlement. The percentage,
the duration and the end date were all copied onto the entitlement at
redemption, so a customer keeps exactly the deal they were given.

### Disable, archive, delete

- **Disable** - stops new redemptions immediately, leaves every existing
  discount running. This is the right answer for a campaign that has to
  be pulled.
- **Archive** - retires it permanently, history intact.
- **Delete** - only for a coupon that has NEVER been redeemed. Anything
  with usage history is refused with a 409 pointing at archive, and the
  foreign keys are `ON DELETE RESTRICT` so the check is a readable error
  rather than the only line of defence. Redemption rows say what a
  customer was charged and why; deleting the coupon they reference would
  leave that unanswerable.

### The detail view

Opening a coupon shows its terms, then:

- **Redemptions** - successful uses, unique customers, remaining against
  the maximum, and the total discount given.
- **By product** - how many redemptions came from each category.
- **Attempts** - every submission including the refusals, broken down by
  reason. "438 redemptions from 1,900 attempts" is a different campaign
  from "438 from 450"; a pile of `invalid_code` means the code is being
  mistyped wherever it was printed, and a pile of `product_not_eligible`
  means it was advertised on the wrong page.
- **Redemption records** - user, product, when, original price, discount,
  final price, and the date that customer's discount runs to.

Redemption records carry no email address. The dashboard identifies
customers by `user_id` everywhere else, and a coupon report is not a
reason to start copying addresses into a marketing screen.

---

## 3. Codes are matched exactly

`ASTRO20` and `astro20` are two different coupons. Creating one while the
other exists is allowed, and only the exact string a customer types will
find a coupon.

Nothing anywhere upper-cases, lower-cases, strips internal spaces,
normalises unicode or tidies punctuation. `coupons.code` is plain `text`
with a plain `UNIQUE`, which in Postgres is byte-exact, and the lookup is
a PostgREST `eq`. The admin form sets `autoCapitalize="none"` and
`autoCorrect="off"` for the same reason, and so does the customer's
input.

The single concession is that surrounding whitespace is trimmed from what
the CUSTOMER submits, because a code pasted out of an email brings a
trailing newline with it and that is a transport artefact rather than
part of the code. The stored value is never touched.

The one place `ilike` appears is the admin SEARCH box, which is about
finding a coupon in a list. That has nothing to do with redemption.

---

## 4. The discount can never exceed 90%

A 100% code is a free-money bug one typo away from being a free-money
incident, and nothing in the product needs one: a genuine giveaway is a
manual per-user grant through the admin plan tools, which is auditable
per account rather than being a string anyone can pass around.

The ceiling is stated in four places and they must agree:

1. `MAX_DISCOUNT_PERCENT` in `backend/app/core/coupons.py`
2. the Pydantic schema (`backend/app/schemas/coupon.py`), so it is a 422
   before any code runs
3. `CHECK (discount_percentage BETWEEN 1 AND 90)` in migration 080
4. the admin form, which reads the ceiling from
   `GET /coupons/admin/options` rather than hardcoding it

At the ceiling a customer still pays a tenth of the price, which stays
comfortably above Razorpay's 100 paise floor for every item on sale, so a
discounted order can never become one the gateway refuses.

Discounts are floored to the paisa, so a rounding error can only ever
favour the business by less than one paisa.

---

## 5. Products, and why a discount never spills over

Three categories, mapped from the payment catalog:

| Category | Catalog items |
| --- | --- |
| Subscriptions | `pro`, `ultra` |
| Reports | `report_token` |
| Questions | `credits_30` (any `credits_*` pack) |

Eligibility is decided per product at the moment of purchase, never
globally for the account. This is the rule behind the case that motivates
the whole design:

> A customer on a plan that includes 2 reports a month uses both, then
> buys a third report separately. Their SUBSCRIPTION coupon must not
> discount that report.

It does not, because the discount lookup is scoped to the product being
bought. A subscription entitlement is simply not consulted for a report
order. If they hold a separate Reports coupon, they can use that one.

Adding a new purchasable item means classifying it in
`product_for_item`. It raises rather than guessing for an unknown item,
so a new product cannot silently fall outside every coupon or inside all
of them.

---

## 6. Discount duration and billing cycles

The duration says how many BILLING EVENTS the discount covers, not how
many days the code was valid for.

| Duration | Monthly billing | Annual billing |
| --- | --- | --- |
| First purchase only | 1 charge | 1 charge |
| 1 month | 1 charge | 1 charge |
| 3 months | 3 charges | 1 charge |
| 6 months | 6 charges | 1 charge |
| 12 months | 12 charges | 1 charge |

This falls out of one division rather than a special case per interval:
enough whole cycles to cover the window, at least one. Three months of
discount on a 365 day cycle is one charge, because the second charge
falls nine months after the discount ended. `BILLING_CYCLE_DAYS` in
`coupon_service.py` is the one knob a yearly plan would turn.

Every product AstroPal sells today runs on the same monthly rhythm: a
plan term is 30 days, and one-off reports and question packs are limited
to one discounted purchase a month so a twelve month coupon cannot be
drained in an afternoon.

One consequence worth knowing: an early renewal inside the same calendar
month as the previous discounted charge does not get a second discount.
The month bucket is deliberately coarse, because the alternative is a
rule the database cannot enforce with an index.

---

## 7. Renewals need no code

Month two of a three month discount is an ordinary `POST /payments/order`
with nothing extra in it. The backend looks for a live entitlement for
that product and applies it, records the cycle in
`coupon_discount_applications`, and decrements `remaining_cycles`. When
the cycles run out or the window closes, the entitlement is retired and
billing returns to the normal price with nothing to remember to switch
off.

The customer-facing surfaces say so: where somebody already holds a
discount for the product they are buying, the coupon field is replaced by
"Your 20% discount applies to this purchase, 2 discounted payments left",
with a link to enter a different code instead.

### Coupons and auto-renewing mandates

A plan bought WITH a coupon goes through the one-off Orders path even
when Razorpay autopay is available, and that is deliberate. An
auto-renewing mandate is charged from the Razorpay Plan, whose amount is
fixed when the plan is created: there is nothing in the mandate a
percentage could be applied to, so opening one would silently bill the
full price the customer just watched being discounted.

The one-off term charges the discounted amount correctly, and the renewal
after it is discounted too, because the next order finds the entitlement.
The checkout page states which of the two is happening in its terms box.

---

## 8. One coupon per product per month

A customer may use only ONE coupon per product in a given calendar month
(UTC), across every coupon. Two coupons for two DIFFERENT products in the
same month is fine and expected:

- Coupon A on Subscriptions and coupon B on Reports: both usable.
- Coupon A and coupon B both on Reports: only one, that month.
- The same coupon twice on the same product in a month: no.

Exclusivity is enforced at the product level, not globally across the
account.

This is a partial unique index on
`(user_id, product, redemption_month) WHERE status <> 'released'`, so it
is a database guarantee rather than a read-then-write check that races.

---

## 9. Concurrency: nobody oversells a limited coupon

Two simultaneous checkouts must never both take the last use of a 500-use
coupon. There is no lock; there are two partial unique indexes.

1. At order creation a `coupon_redemptions` row is inserted as
   `reserved`, with `slot_number = (live redemptions + 1)`.
2. `UNIQUE (coupon_id, slot_number) WHERE status <> 'released'` means two
   racing requests computing the same number collide, and Postgres lets
   exactly one through.
3. The loser recounts and retries. If the coupon is now full, it gets
   `usage_limit_reached` rather than a database error.

The same count is used both to check the limit and to allocate the slot.
Counting twice is not merely wasteful: if the limit is checked against
one count and the slot derived from a later one, a redemption racing in
between produces a slot above the maximum and the coupon oversells by
one.

### Reservations and releases

A reservation is confirmed (`redeemed`) when the payment settles, and
released (`released`) if it never does. A released row drops out of both
partial indexes, which hands the slot and the customer's month straight
back. So:

- A failed card consumes no redemption.
- An abandoned checkout consumes no redemption: a reservation older than
  `RESERVATION_TTL_MINUTES` (30) is reclaimed the next time that customer
  starts a purchase, with no background job.
- A failed VALIDATION consumes nothing at all, because nothing was ever
  reserved.

A client-reported failure racing a webhook that already settled the
payment cannot release a real redemption: the release only fires for the
caller that actually moved the payment row from `created` to `failed`.

---

## 10. Validation, in order

When a customer submits a code, all of this is checked before a slot can
be taken. Preview (the Apply button) runs exactly the same list.

1. The coupon exists.
2. The code matches exactly.
3. It is published (not draft, disabled or archived).
4. Now is inside `starts_at` .. `expires_at`.
5. It applies to the product being bought.
6. It is within its maximum redemptions.
7. This customer has not already used a coupon for this product this
   month.
8. The reservation is inserted, which is where the two indexes have the
   final say.
9. The discount is computed server-side and frozen into the payment row.

Product eligibility is reported BEFORE the usage limit on purpose:
somebody holding a Reports code at a subscription checkout is better told
"this code is for Reports" than "this code is used up".

Error codes, which the frontend and the admin analytics both read:

| Code | Message |
| --- | --- |
| `invalid_code` | Invalid coupon code. |
| `coupon_inactive` | This coupon is not available. |
| `coupon_not_started` | This coupon is not yet active. |
| `coupon_expired` | This coupon has expired. |
| `product_not_eligible` | Not valid for this product (and says which it is for). |
| `usage_limit_reached` | This coupon has reached its usage limit. |
| `already_used_this_month` | You have already used a coupon for this product this month. |
| `coupon_busy` | Lost a race for the last redemption; try again. |
| `coupons_unavailable` | Migration 080 is not applied. |

### Eligibility does NOT depend on who the customer is

There is no new-versus-existing distinction anywhere, and the validator's
signature has no parameter that could carry one. Every coupon is
available to everybody; eligibility is the window, the product, the
limits, and what they have already used this month.

---

## 11. Preview versus redemption

`POST /coupons/preview` is the Apply button. It runs every rule and
reserves nothing, so:

- Previewing a hundred times cannot use a coupon up.
- A customer learns about a problem before a payment modal opens rather
  than after.
- A preview that passed is never treated as a promise. The order path
  re-runs everything and can still lose a race for the last slot, which
  is the honest behaviour.

Both previews and checkout submissions are logged to `coupon_attempts`
with their phase, so a code that previews fine and fails at checkout
shows up as a race rather than disappearing.

---

## 12. Edge cases, and what happens

| Situation | Behaviour |
| --- | --- |
| Coupon expires after redemption | The customer's discount continues to its own end date. |
| Coupon disabled after redemption | Same. Disable stops new redemptions only. |
| Coupon edited after redemption | Existing entitlements keep the terms they were given. |
| Customer moves Pro to Ultra | The discount continues, because Ultra is still inside the coupon's product scope. It would not continue onto a product outside that scope. |
| Customer buys a report outside their plan | Full price, unless they hold a Reports coupon or entitlement. |
| Two purchases of the same product in one month | Only the first is discounted. |
| Two coupons for different products | Both allowed, independently. |
| Failed payment | No redemption consumed; slot and month released. |
| Abandoned checkout | Same, after the 30 minute reservation TTL. |
| Concurrent checkout on the last slot | Exactly one succeeds; the other gets `usage_limit_reached`. |
| Customer redeems a new code while one is running | The new code supersedes the old entitlement (`ended_reason = superseded_by_new_coupon`). Two live entitlements for one product would make "which percentage applies" a question with no answer. |
| Customer cancels and later resubscribes | The subscription entitlement is cancelled when the plan actually LAPSES, so a new purchase is evaluated against the coupon rules from scratch. Cancelling without lapsing does not end it: the paid term is still running and so is the discount they bought with it. |

---

## 13. Data model

Five tables, in `backend/migrations/080_discount_coupons.sql`.

**`coupons`** - the promotional rule. `code` (unique, byte-exact),
`discount_percentage` (1-90), `eligible_products`, `discount_duration`,
`starts_at`, `expires_at`, `max_redemptions`, `lifecycle`.

**`coupon_redemptions`** - one customer spending one coupon, once.
Carries `slot_number` and `redemption_month` (the two concurrency
guards), the money frozen at reservation, and the discount terms copied
off the coupon. `status` is `reserved` / `redeemed` / `released`.

**`coupon_discount_entitlements`** - what the customer is owed
afterwards. Its own `starts_at` / `ends_at` / `remaining_cycles` /
`total_cycles`, scoped to one product, at most one live per product per
customer.

**`coupon_discount_applications`** - the billing ledger. One row per
charge that received a discount, with `cycle_number` and
`application_month`, both unique per entitlement among live rows. This is
how the billing system knows exactly which periods were discounted,
rather than recomputing it from the coupon every cycle.

**`coupon_attempts`** - every submission, successful or not. Purely
analytics: a row here never grants anything, and a failed attempt never
consumes a redemption.

`payments` also gains `coupon_code`, `coupon_redemption_id`,
`discount_application_id`, `original_amount` and `discount_amount`, so a
refund or a support question never has to reconstruct the discount from
three tables.

### Security posture

Every table is service-role write only, and INSERT / UPDATE / DELETE are
revoked from `authenticated` and `anon` (migration 073 showed what a
single permissive policy is worth on a table carrying entitlement
columns). Customers may SELECT their own redemptions, entitlements and
applications.

`coupons` itself is deliberately NOT readable from the browser: the list
of live codes is a marketing asset, and a user who can enumerate it can
find the 90% one.

---

## 14. What the customer sees

The coupon field appears wherever a purchase is made:

- `/checkout` for Pro and Ultra
- the credits page for question packs
- the report purchase sheet for a one-off report

Applying a code shows the original price, the percentage, the amount
taken off, the final price, and how long the discount lasts. For a
recurring discount it spells out what happens when it ends:

> ₹880 for your first 3 payments, then ₹1,100.

Every one of those numbers comes from the server's quote. The browser
never multiplies a price by a percentage: doing so is how a customer
reads one figure on the page and is charged another at the modal.

The field hides itself for a signed-out visitor (a discount attaches to
an account, and the credits page is public) and when the coupon tables
are missing.

---

## 15. Deploying

1. Apply `backend/migrations/080_discount_coupons.sql` in Supabase.
2. Deploy the backend. Until the migration is applied, coupons report
   themselves unavailable: purchases still work at full price, a typed
   code is refused with `coupons_unavailable` rather than being silently
   ignored, and the admin screen shows the migration name.
3. Deploy the admin app and the main frontend.

The order matters in that direction only. A backend deployed before the
migration degrades safely; a migration applied early is harmless.

---

## 16. Tests

`backend/tests/test_coupons.py`, 164 tests. The load-bearing ones:

- exact code matching, including near misses that must NOT match
- the 90% ceiling, in the domain, the schema and the migration text
- the full validation list, one rule at a time, with its error code
- concurrency: a frozen count racing a competitor's insert, proving a
  1-use coupon cannot be redeemed twice, and that a lost race with slots
  left simply takes the next number
- one coupon per product per month, and two coupons for different
  products coexisting
- a coupon expiring, being disabled and being edited, none of which
  touch a granted discount
- a subscription discount not reaching a report or a question pack
- a failed payment releasing its slot, and a settled one not being
  releasable
- the whole path end to end through `payment_service.create_order` and
  `verify_and_settle`, asserting Razorpay is asked for the discounted
  amount

The in-memory `FakeSupabase` models the partial unique indexes, so the
concurrency tests drive the real reservation code against a store that
rejects a duplicate insert exactly as Postgres does. A fake that silently
accepted both would let a broken reservation path pass its tests and then
oversell a limited coupon in production.
