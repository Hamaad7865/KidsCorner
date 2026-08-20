# Kids Corner Till — native Android

The shop-floor till. Kotlin and Jetpack Compose, built for a wall-mounted
landscape tablet.

## The one rule

**This app never decides what anything costs.**

It posts variant ids and quantities to `/api/till/sale` on the Next app, and the
server re-prices every line from `product_variants`, re-settles every discount
against the `discounts` table, and verifies any manager approval — then commits.

That is why the till does not talk to Supabase directly for sales, which is
otherwise the obvious thing to do. The `complete_sale_keyed` RPC accepts
`unit_price` per line and trusts it; the re-pricing that makes that safe lives in
`lib/pos/sale-core.ts`. A client going straight to PostgREST would skip it and
could ring anything up at zero.

Prices cached on the device are for **display only**. A stale cache shows an old
price; it can never charge one.

The one exception is sign-in, which goes straight to Supabase Auth — password
grant and refresh are GoTrue's job, and proxying them would put the shop's
password through a second server for nothing.

## Two identities

| | What it is | How often |
|---|---|---|
| **Device account** | Email + password, one shared shop account | Once, at install |
| **Cashier** | 4-digit PIN, decides whose name goes on a sale | Many times a day |

A cashier is never asked for an email and password across a counter. The PIN is
checked on the server — `profiles.pin_code` is a PBKDF2 hash of four digits, so
anything holding it can exhaust all 10,000 values in under a second. Migration
010's counter lives in the database, where reinstalling the app cannot reset it:
three misses are free, then the wait doubles to a 5-minute cap.

## Build and run

Requires JDK 17 and the Android SDK. Gradle comes from the wrapper.

```bash
cd till-android && ./gradlew :app:assembleDebug
```

Install on a running emulator or device:

```bash
adb install -r till-android/app/build/outputs/apk/debug/app-debug.apk
```

A debug build points at `http://10.0.2.2:3001` — the emulator's route to the
host, on the port in `.claude/launch.json`. So `npm run dev` must be running.
Release points at `https://kidscorner.mu` and cleartext is refused everywhere
except that emulator address.

Supabase URL and anon key are read at build time from the repository's
`.env.local`, so the till and the back office can never point at different
projects.

`local.properties` uses **forward slashes**. It is a Java `.properties` file, so
`C:\Users\…` parses as `C:Users…` and fails much later as "The filename,
directory name, or volume label syntax is incorrect".

## Layout

```
data/     SessionStore   encrypted tokens, Keystore-backed
          AuthClient     Supabase GoTrue sign-in and refresh
          TillApi        Ktor client for /api/till
          TillRepository token lifecycle; refresh serialised behind a mutex
ui/       theme/         the web app's oklch ramp, converted to sRGB
          LockScreen     staff list + PIN keypad
          DeviceSetup    one-time owner sign-in
          ReadyScreen    placeholder for the sell screen
TillViewModel            screen state
```

## Sizing

Density is scaled so every screen lays out against ~1000dp of width regardless
of panel size (`TARGET_WIDTH_DP` in `Theme.kt`). A 15" shop tablet reports
2048dp across at its native density, which would put a 96dp key at about 0.6" —
too small to hit without looking down, which is the one thing a cashier facing a
customer cannot do. Same idea as the web till's `clamp()` on the root font size.

## Credit customers

The till bills to an account through a dedicated **ON ACCOUNT** tile on the
payment screen — never through the ordinary method list. That is the gate made
visible: `settings.payment_methods` deliberately excludes `credit`, because
every other tile is unconditional and this one is only legal for a named
customer with an open account. The tile shows the attached customer's available
credit, refuses a basket larger than it, and says why in words the cashier can
read out. One tap bills the whole outstanding balance and completes the sale.

Payments *against* an account — the customer walking in to settle — live under
Till actions → **Payment on account**. Cash needs an open shift, because the
payment is recorded into that drawer; with no shift open the cash chip is not
offered.

Neither the tile nor the dialog decides anything about money. The server
re-reads the account and the database re-checks the limit under a per-customer
lock, so a stale balance on the device can show an old number but can never
authorise a charge. Settlements are never queued offline: unlike a sale, a
payment on account is refused or accepted against a balance only the server
knows.

## Not built yet

- Idle re-lock

The sell screen, offline queue, receipt printing and reprints — listed as
unbuilt in an earlier revision — all exist and are in daily use.
