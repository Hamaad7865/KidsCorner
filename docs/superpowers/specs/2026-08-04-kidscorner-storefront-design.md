# KidsCorner Storefront Design

**Status:** Approved for implementation planning  
**Date:** 2026-08-04  
**Project:** KidsCorner POS, back office, and customer storefront

## 1. Decision summary

KidsCorner will gain a public, mobile-first storefront inside the existing
Next.js and Supabase application. It will share the current catalogue, product
images, variants, prices, and stock truth with the POS and back office. It will
not become a separately maintained shop or duplicate the catalogue in an
external commerce platform.

The approved customer experience is:

- the **Playful Edit** visual direction: modern, spacious, photographic, and
  playful without looking childish;
- a balanced home page featuring everyday clothing, new arrivals, and wedding
  or occasionwear;
- browsing by department, age or size, colour, price, and availability;
- guest checkout by default, with customer accounts optional;
- doorstep delivery as the primary fulfilment method;
- online payment and payment at the doorstep;
- private order tracking for guests;
- optional account creation only after an order succeeds; and
- an **immutable payment ledger**. Payments can only be appended. Refunds,
  reversals, chargebacks, failures, and corrections create new entries that
  reference earlier entries; no payment entry can be updated or deleted.

## 2. Existing-system constraints

The design extends the existing system rather than replacing its working
boundaries:

- `products` are parents and `product_variants` are the sellable size and colour
  units.
- `stock_movements` is physical stock truth. `qty_on_hand` is a cache maintained
  through stock RPCs and must never be edited directly.
- POS sales are completed atomically through the existing sale RPC and currently
  create the sale, items, payments, and stock movement together.
- stock can be derived per location; the storefront needs one configured
  fulfilment location.
- `products.image_url` currently supports one primary image, and the public
  `product-images` bucket already exists.
- catalogue reads are currently authenticated-only and expose fields, such as
  cost price, that must never be available to anonymous shoppers.
- `/` currently routes staff to the back office or POS, and middleware redirects
  unauthenticated visitors to `/login`. The public storefront requires a new
  routing boundary.
- staff accounts use `profiles` with owner, manager, and cashier roles. Customer
  accounts must not be inserted into that staff role model.
- prices are VAT-inclusive, use MUR, and are rounded at two-decimal boundaries.
- migrations are additive. Existing numbered migrations remain historical and
  are not edited.

## 3. Goals and non-goals

### Goals

1. Let a customer discover an active product, choose an available variant, and
   place a delivery order on a phone without needing an account.
2. Keep one source of truth for names, images, prices, variants, and stock.
3. Prevent overselling when POS and storefront customers compete for the same
   physical unit.
4. Let staff prepare, dispatch, cancel, and complete online orders from the back
   office with a full audit trail.
5. Keep online and doorstep payment histories immutable, idempotent, and
   reconcilable.
6. Preserve the existing POS and reporting behaviour while adding storefront
   capabilities additively.
7. Produce indexable collection and product pages with good mobile performance
   and accessible interactions.

### Non-goals for the first release

- multi-vendor marketplace behaviour;
- customer reviews, loyalty points, gift cards, or referral programmes;
- a native customer mobile app;
- automated outbound WhatsApp messaging without a separately approved provider;
- customer self-service returns; existing staff return workflows remain the
  operational route;
- wishlists or saved-product hearts; the hearts in the concept mockups are
  illustrative and should be omitted from the first build;
- provider-specific online-payment behaviour before a payment provider and its
  credentials are supplied; and
- promotion-code entry. Existing automatic discount rules may be reused only
  when explicitly marked as storefront-safe.

## 4. Information architecture and routing

The public storefront owns these routes:

| Route | Purpose |
| --- | --- |
| `/` | Public storefront home page |
| `/shop` | All active storefront products |
| `/shop/[category]` | Collection page with filters and sorting |
| `/search` | Public product search results |
| `/product/[slug]` | Product gallery, variant selection, delivery information |
| `/cart` | Full-page bag fallback; the normal entry is a cart drawer |
| `/checkout` | Guest-first delivery and payment flow |
| `/order/[trackingToken]` | Private guest confirmation and tracking |
| `/account/sign-in` | Customer sign-in, separate from staff login |
| `/account/orders` | Authenticated customer order history |
| `/delivery`, `/returns`, `/privacy`, `/terms` | Store policies |

Staff routes remain explicit:

- `/login` for staff authentication;
- `/dashboard` and the existing admin routes for owners and managers; and
- `/pos` for the till.

Middleware must treat storefront routes as public without redirecting a signed-in
staff member away from them. `/login` may retain its existing staff redirect.
Customer authentication uses a separate account route and table linkage; it does
not create a cashier-like `profiles` row.

## 5. Visual system

### Brand character

The storefront should feel like a small, confident children's fashion boutique:
joyful for children and dependable for parents. It must avoid both generic
minimal e-commerce and dense toy-store styling.

### Palette

- **KidsCorner cherry** `#A71937`: primary brand actions and selected states.
- **Deep plum ink** `#2F2630`: headings, body text, and high-contrast navigation.
- **Pool blue** `#2D7582`: complementary primary action and informational cues.
- **Mango** `#F1C453`: restrained highlights.
- **Petal** `#F5D7DD`, **sky** `#C8E5E9`, and **leaf** `#CCD9B9`: category fields.
- **Paper** `#FBFAF8` and white: primary surfaces.

Cherry is not used for every decorative element. It remains the recognisable
brand anchor and keeps destructive red semantically separate in staff screens.

### Typography

- **Bricolage Grotesque** for concise display headings and the storefront
  wordmark treatment.
- **Instrument Sans** for navigation, body copy, controls, prices, and forms.
- Tabular numerals for prices, quantities, and order totals.

Fonts must use `next/font`, include only required weights, and reserve layout
space to avoid cumulative layout shift.

### Signature element

Product and campaign imagery uses a **turned-corner frame**: mostly soft rounded
corners with one deeper corner radius. It is a restrained reference to the
KidsCorner name, not a repeated decorative blob. Category cards use simple
colour fields and one oversized edge shape.

### Interaction and accessibility

- Minimum interactive target: 44 by 44 CSS pixels.
- Body text is at least 16px on mobile forms.
- Visible keyboard focus is never removed.
- Colour is not the only indicator for stock, errors, or selection.
- Motion is limited to meaningful drawer, filter-sheet, and state transitions of
  150–300ms and respects `prefers-reduced-motion`.
- Product images have content-specific alternative text; decorative shapes are
  hidden from assistive technology.
- Mobile zoom is not disabled.

## 6. Page and component design

### 6.1 Home page

The home page is arranged in this order:

1. delivery and payment announcement;
2. primary navigation and search;
3. one seasonal hero with one dominant action and one subordinate link;
4. department cards for Girls, Boys, Baby, and Shoes;
5. new arrivals sourced from active, available catalogue items;
6. an occasionwear campaign block;
7. delivery, real-stock, and community reassurance; and
8. policy, contact, social, and account links in the footer.

The hero content is editable through storefront settings rather than hardcoded.
Every campaign needs a headline, supporting copy, target URL, desktop image,
mobile crop, start and end time, and active flag. If no campaign is active, the
home page falls back to new arrivals.

### 6.2 Header, search, and navigation

Desktop navigation exposes the primary departments, occasionwear, and sale.
Mobile uses a compact header with menu, search, and bag. Search opens a full-width
field with recent queries stored on the device and server results grouped by
product. Search never returns inactive products or unavailable-only products
unless the customer explicitly disables the availability filter.

The bag count updates immediately, but the server rechecks availability before
accepting an order.

### 6.3 Collection pages

Collection pages provide:

- category and occasion filters;
- age or size filters;
- colour filters with both a swatch and text label;
- price range;
- available-now toggle;
- sorting by newest, price ascending, and price descending; and
- URL-backed filters so results can be shared and browser navigation works.

Desktop filters use a sidebar. Mobile filters use a bottom sheet with an explicit
Apply button, result count, and Clear all action. Applied filters remain visible
as removable chips. Returning from a product restores scroll position and
filters.

### 6.4 Product cards

A product card shows the primary image, name, price or price range, available
colour count, and an optional New or Sale badge. It does not expose a single
variant as if all sizes share its availability. Product images reserve their
aspect ratio and use responsive AVIF/WebP delivery through Next Image.

### 6.5 Product detail

The product page contains:

- ordered product gallery;
- name, category, brand when present, and VAT-inclusive price;
- colour selector with accessible labels;
- size selector showing available, low-stock, and unavailable states;
- size guide appropriate to clothing or shoe sizes;
- delivery and returns summary;
- WhatsApp help link;
- quantity control; and
- one Add to bag action that names the selected price.

Colour and size selection resolves a concrete `product_variant`. The Add to bag
action remains disabled until a valid available variant is selected. On mobile,
the selected variant and Add to bag action use a sticky bottom bar that leaves
content unobscured.

The existing single `products.image_url` remains the primary-image compatibility
field. A new ordered `product_images` table supports the approved gallery and
allows alt text, position, and primary-image designation. The back-office product
editor gains gallery management.

### 6.6 Bag

Adding a product opens a cart drawer without removing the customer from their
current page. `/cart` provides the same content as a full-page fallback.

Each line preserves and displays product, colour, size, quantity, and unit
price. Quantity changes check availability. Delivery is described as calculated
from the address; a fictional flat fee is not shown before an address is known.
The bag persists locally for convenience but the local copy is never treated as
price or stock authority.

### 6.7 Guest checkout

Checkout is a single progressive page with these sections:

1. contact name, email, and Mauritian mobile number;
2. house or building, street and landmark, town or village, district, and an
   optional delivery note;
3. fulfilment method; and
4. payment choice.

Doorstep delivery is required. Rose Hill collection is a configuration-controlled
secondary option from the approved design. It is disabled by default and is not
rendered until the owner enables it with collection instructions and opening
hours.
The delivery quote and estimate appear before the customer places the order.

Payment choices are:

- **Pay securely online**, enabled only when a provider is configured and
  healthy; and
- **Pay at your doorstep**, which creates no payment entry until money is
  collected.

The order summary remains visible on desktop and collapsible above the form on
mobile. Labels remain visible; placeholders are examples, not labels. Validation
occurs after blur and on submit, moves focus to the first invalid field, and
keeps entered data when recoverable failures occur.

### 6.8 Confirmation, tracking, and account creation

Successful checkout displays:

- public order number;
- confirmation status;
- delivery destination;
- payment state and amount due;
- item summary;
- delivery-status timeline;
- private tracking link; and
- Continue shopping.

Guest tracking uses a high-entropy random token. Only a hash is stored. The order
number and email address alone are insufficient to access an order.

After success, the customer may choose **Create my account**. This sends a secure
verification or magic-link flow and links the verified account to the existing
order. Checkout never asks for a password. Customer account linkage uses a new
table connected to the existing `customers` record; it does not reuse staff
`profiles`.

Order confirmation and status email use a transactional-email adapter with
idempotent message keys. Production launch requires a verified sender domain and
successful delivery smoke test. WhatsApp is a customer-initiated support link in
the first release, not an automated notification channel.

## 7. Back-office order operations

The back office gains an **Online orders** module beside Sales. It offers a board
and filterable table with these operational states:

- pending payment;
- new;
- confirmed;
- preparing;
- out for delivery;
- delivered;
- cancelled; and
- payment failed.

The order detail shows contact and address snapshots, payment balance, items,
reservation state, status history, internal notes, and a printable pick list.
Only permitted staff can change operational status. Every change appends an
order event with actor, source, timestamp, previous state, new state, and reason.

The module-access matrix gains `online_orders`, enabled for owner and manager and
disabled for cashier by default. This visibility rule supplements, but does not
replace, RLS and RPC authorization.

The dashboard shows new-order count and overdue preparation. Product and stock
screens show stock reserved for online orders separately from physical quantity.

## 8. Data model and boundaries

The exact SQL belongs in the implementation plan, but the model has these
required boundaries.

### 8.1 Public catalogue projection

Anonymous clients must never receive raw `product_variants` rows because those
contain cost price, barcode, and internal reorder data. Public catalogue reads
use narrowly granted RPCs or a curated projection that returns only:

- product and category identifiers, names, slugs, descriptions, and active
  status;
- public brand and gender labels;
- ordered public image URLs and alt text;
- variant ID, size label, colour label and hex, selling price, and a coarse
  availability state; and
- storefront-safe discount result.

Every anonymous catalogue function uses a pinned `search_path`, explicit
function-level grants, bounded pagination, and only the minimum `anon` execute
permission required for that function. The existing blanket revocation of
anonymous function execution remains intact.

The projection never returns cost price, supplier data, barcode, reorder level,
raw movement rows, or exact stock counts. Low-stock UI uses a coarse threshold
such as `low_stock`, not the internal count, except for approved customer-facing
copy such as “Only 2 left.”

### 8.2 Storefront orders

`storefront_orders` stores the operational order, public order number, optional
existing customer reference, immutable contact and address snapshots, currency,
subtotal, discount, delivery fee, tax total, grand total, fulfilment location,
tracking-token hash, timestamps, and a cached current status.

`storefront_order_items` stores immutable product and variant references plus
name, SKU, size, colour, unit price, discount, tax, quantity, and line-total
snapshots. Historical orders therefore remain readable after catalogue edits.

The contact and address captured at placement remain the original snapshot. If
staff correct delivery details before dispatch, a narrow RPC appends a revision
with actor and reason; the delivery view uses the latest revision without
rewriting the submitted snapshot.

`storefront_order_events` is append-only and provides the authoritative status
history. The cached current status may change only through the order-transition
RPC, which validates allowed transitions and appends the event atomically.

### 8.3 Reservations and available-to-sell

`stock_reservations` links an order to a variant, fulfilment location, quantity,
expiry, release, and consumption state. Available-to-sell is derived as physical
location stock minus active, unexpired reservations.

The order-placement RPC locks the relevant variants, rechecks active status,
price, discount, and available-to-sell, creates order snapshots, and creates
reservations in one transaction. Two customers competing for the final unit
cannot both succeed.

Default reservation policy is configurable through settings:

- online-payment attempt: 20 minutes;
- unconfirmed doorstep order: 24 hours; and
- confirmed or preparing order: held until completed or cancelled.

Expired or cancelled reservations stop reducing available-to-sell. Online-paid
dispatch consumes the reservation and records stock out at the configured
fulfilment location. Doorstep dispatch consumes the source reservation while
transferring the same units to the in-transit location, as specified below.

### 8.4 Immutable payment ledger

The storefront payment journal is append-only. Each entry records:

- order reference and optional finalized sale reference;
- event type: initiated, authorised, captured, failed, collected, refunded,
  reversed, chargeback, or correction;
- signed amount and currency;
- payment method and provider;
- unique idempotency key;
- unique provider event or transaction ID when present;
- reference to the original payment entry for compensating events;
- source, actor, timestamp, and safe provider metadata.

Required database invariants:

1. Application roles receive no `UPDATE` or `DELETE` grant on payment entries.
2. Defensive triggers reject updates and deletes, including from application
   security-definer functions.
3. Refunds, reversals, chargebacks, and corrections append new signed entries
   referencing the original entry.
4. Provider event IDs and idempotency keys are unique.
5. Paid, due, and refunded values are derived from entries; no mutable payment
   status or balance is authoritative.
6. Provider callbacks are signature-verified before insertion.
7. Replayed callbacks return the original result without adding an entry.

Existing finalized `sale_payments` must also be hardened against application
updates and deletes in the new migration. Their foreign-key behaviour must not
allow a sale deletion to cascade away a payment. The storefront journal records
pre-sale payment lifecycle; `sale_payments` remains the immutable fiscal posting
used by existing sales reports. When an order becomes a sale, the fiscal payment
row references a unique source storefront entry so it can be posted exactly
once. Reports must use one ledger for their stated purpose and never sum both.

Online provider adapters implement the same create-attempt, verify-callback,
query-status, and refund interface. Until an adapter and credentials are
configured, the online choice is disabled and the storefront can be exercised
with doorstep payment in non-production environments. Production launch of the
approved design requires both choices to be enabled and smoke-tested.

### 8.5 Sale finalisation

An online order is not inserted directly as a completed POS sale when it is
placed. The fiscal completion moment depends on payment path:

- an online-paid order becomes a sale when staff dispatch it; and
- a doorstep-payment order becomes a sale when delivery and collection are
  confirmed together.

Dispatching an unpaid doorstep order atomically consumes the source reservation,
transfers the same physical units from the storefront fulfilment location to a
configured **Delivery in transit** stock location, and records order custody as
in transit. This prevents the source location from subtracting both a transfer
and a reservation. The transfer preserves physical traceability without
pretending that a sale or payment has happened. A failed delivery transfers the
units back. A successful delivery consumes them from the in-transit location.

At the appropriate completion moment, a dedicated idempotent fulfilment RPC
atomically:

1. verifies the order and either its active reservations or its in-transit
   custody allocation;
2. verifies sufficient paid balance or an approved doorstep collection;
3. creates the finalized sale and item snapshots;
4. appends the fiscal payment posting once;
5. for online-paid dispatch, consumes the active reservation and records stock
   out from the fulfilment location; for doorstep completion, records stock out
   from the in-transit allocation, whose source reservation was consumed at
   dispatch;
6. links the order and sale; and
7. appends the order completion event.

Repeated fulfilment calls return the existing sale and never create a second
sale, payment, or stock movement.

The finalized sale is marked with `source = 'storefront'`, carries a unique
storefront-order reference, and has no till shift. Doorstep cash is therefore
included in business sales and delivery reconciliation but never in a cashier's
drawer or Z-report expectation. Existing overall reports must include
storefront-source sales where appropriate while shift reports remain scoped to
their shift.

### 8.6 Delivery configuration

Delivery pricing is data, not component logic. Active delivery-zone records
define district and optional town or village matching, VAT-inclusive fee,
minimum and maximum working-day estimate, display label, and priority. A single
fallback Mauritius zone may be configured; if no active rule matches, checkout
does not invent a price and instead offers retry and contact support.

The back-office storefront settings choose the fulfilment location, in-transit
location, enabled delivery zones, and whether Rose Hill collection is available.
The delivery quote returned to checkout has an opaque quote ID and expiry. Order
placement recomputes the quote from the submitted address so a client cannot
alter its fee or estimate.

## 9. Core server operations

All public input is validated with Zod and all multi-row writes use database
transactions through narrow RPCs.

- `get_storefront_home()` returns active campaign, categories, and new arrivals.
- `search_storefront_catalog(filters)` returns a paginated safe projection.
- `get_storefront_product(slug)` returns safe product, image, and variant data.
- `quote_delivery(address, method)` returns an active configured quote.
- `place_storefront_order(payload, idempotencyKey)` validates totals and creates
  the order and reservations.
- `create_online_payment_attempt(order, idempotencyKey)` creates an attempt
  without mutating earlier entries.
- `record_verified_payment_event(providerEvent)` appends an idempotent ledger
  entry after signature verification.
- `transition_storefront_order(order, transition, reason)` validates transition
  and appends an audit event.
- `finalize_storefront_order(order, paymentEvidence, idempotencyKey)` creates the
  sale, fiscal payment, and stock movement once.
- `cancel_storefront_order(order, reason)` appends cancellation and releases
  reservations; any money return is a separate appended refund operation.

Client code never supplies authoritative prices, discounts, delivery fees,
payment state, or order totals.

## 10. Failure and recovery design

| Failure | Customer experience | System behaviour |
| --- | --- | --- |
| Variant sold before checkout | Exact line is highlighted with available alternatives | Order transaction rolls back; no partial order or reservation |
| Price changed | Old and new price are shown and acceptance is required | Server remains authoritative; cart data is preserved |
| Delivery quote unavailable | Retry and WhatsApp help are offered | Order cannot be placed without a final delivery total |
| Online payment declined | Clear decline state with retry or doorstep-payment choice | Failed event is appended; reservation remains until its expiry |
| Payment callback repeated | No visible duplicate effect | Unique provider event returns the prior result |
| Payment succeeds but browser closes | Email link opens the confirmed order | Verified callback appends the payment event; the derived paid state does not depend on the browser |
| Order submission times out | “Check order status” rather than blind resubmit | Idempotency key returns the existing order if it was created |
| Staff cancels paid order | Customer receives cancellation and refund status | Cancellation and refund are separate appended events |
| Tracking token is invalid | Generic unavailable message with support link | No order or customer information leaks |
| Notification fails | Confirmation page still succeeds and offers resend | Order remains valid; notification retry is audited |

## 11. Security and privacy

- Public catalogue access is allowlisted by field, never granted on raw internal
  tables.
- Customer PII is visible only to the order owner through an authenticated
  account or to a bearer of the high-entropy tracking token; staff access is
  role-restricted and audited.
- Tracking tokens are random, single-order, revocable, and stored hashed.
- Payment provider secrets and webhook verification keys remain server-only.
- Payment callbacks verify signature, environment, currency, order reference,
  and amount.
- Checkout and tracking endpoints are rate-limited. Bot challenges may appear
  only after suspicious activity, not for every shopper.
- Logs redact address, phone, email, tokens, and provider payload secrets.
- No service-role credential is exposed to the browser.
- Content Security Policy, secure cookies, CSRF protections, and normal Next.js
  server-action origin checks remain enabled.

## 12. Performance, SEO, and content

- Home and collection pages use server rendering and cache safe public catalogue
  reads with explicit invalidation after catalogue changes.
- Product pages emit Product and Breadcrumb JSON-LD with current public price and
  availability.
- Collection and product slugs are unique and stable; redirects preserve old
  slugs after renaming.
- Generate sitemap, robots rules, canonical URLs, Open Graph metadata, and a
  KidsCorner social image.
- Reserve image dimensions, use responsive sizes, lazy-load below-fold imagery,
  and keep the hero image as the only high-priority product image.
- Target no horizontal overflow at 375px, CLS below 0.1, and useful interaction
  feedback within 100ms even when the network operation continues.
- Product names, descriptions, gallery alt text, and campaign content are managed
  from the back office rather than embedded in components.

## 13. Verification requirements

### Unit and database tests

- price and VAT rounding;
- safe public projection excludes cost price and internal stock fields;
- available-to-sell subtracts only active reservations;
- reservation expiry and release;
- doorstep dispatch consumes the source reservation exactly once, transfers the
  same quantity to the in-transit location, and does not double-subtract
  available stock;
- legal and illegal order-state transitions;
- tracking token hashing and lookup;
- payment balance derivation from signed entries;
- direct storefront-payment and finalized `sale_payments` `UPDATE` and `DELETE`
  fail;
- refund and reversal append without altering original entries;
- duplicate provider events and idempotency keys do not duplicate money;
- order finalisation called twice creates one sale, payment posting, and stock
  movement; and
- two simultaneous orders for the final unit produce one success and one clear
  out-of-stock result.

### Integration tests

- anonymous home, collection, search, and product reads;
- guest doorstep checkout;
- online-payment success, decline, browser abandonment, callback replay, and
  refund;
- delivery quote failure and recovery;
- cancellation before and after payment;
- order completion and reservation consumption;
- a failed doorstep delivery returns in-transit stock without creating a sale or
  payment;
- doorstep cash appears in delivery reconciliation and overall sales but not in
  till drawer or Z-report expectations;
- delivery-zone priority, fallback, expired quote, and fee-tampering behaviour;
- customer account creation after an order and verified order linking; and
- staff permissions and audit attribution in Online orders.

### Browser and accessibility tests

- complete guest purchase at 375px, 768px, 1280px, and 1440px;
- keyboard-only product selection, cart, checkout, and tracking;
- screen-reader labels and error announcements;
- visible focus and 44px touch targets;
- reduced-motion behaviour;
- 200% text zoom without hidden actions;
- contrast of all text, controls, and stock states; and
- back navigation restores collection filters and position.

### Release checks

- migrations apply to a fresh database and an existing copy;
- generated database types and the catch-up snapshot are updated from the
  verified schema;
- storefront feature flag can be disabled without affecting POS or back office;
- payment provider is verified in sandbox and production with a small controlled
  transaction and refund;
- payment and sales reconciliation agrees with provider totals;
- deployed health and commit identity are visible; and
- a real mobile device completes both online and doorstep test orders without
  overselling or duplicate ledger entries.

## 14. Acceptance criteria

The storefront design is implemented successfully when:

1. a signed-out customer can browse active products without seeing internal
   catalogue fields;
2. desktop and mobile match the approved Playful Edit hierarchy;
3. the customer can select a concrete available size and colour;
4. a guest can place a doorstep order and, when configured, an online-paid
   order;
5. stock cannot be oversold across POS and storefront races;
6. staff can prepare, dispatch, cancel, and complete the order with an audit
   history;
7. order completion writes the final sale, fiscal payment, and stock movement
   exactly once;
8. payment entries cannot be changed or removed, and every correction is a new
   related entry;
9. guests can privately track orders and optionally create an account afterward;
10. all specified database, integration, accessibility, and release checks pass.
