# Deploying Kids Corner

Next.js on **Cloudflare Workers** via the OpenNext adapter. Not Pages — the
`next-on-pages` package for Pages is deprecated and Cloudflare's own docs now
point Next.js at Workers.

The order below gets the site live and tested on a free `workers.dev` URL
first. The domain is the last step and takes five minutes once the nameservers
have moved, so nothing waits on the registrar.

---

## 1 · Push to GitHub

The repo is already initialised and committed. Create an **empty private** repo
on GitHub (no README, no .gitignore — the first push carries them), then:

```bash
git remote add origin https://github.com/<you>/kidscorner.git
git push -u origin main
```

**Check:** the files appear on GitHub, and `.env.local` does **not**. If you can
see it, stop and tell me — the Supabase keys would be public.

---

## 2 · Cloudflare account ID

Dashboard → **Workers & Pages**. The Account ID is in the right-hand column.
Copy it.

---

## 3 · Cloudflare API token

Dashboard → **My Profile** → **API Tokens** → **Create Token** → use the
**"Edit Cloudflare Workers"** template.

Leave the permissions as the template sets them. Under *Account Resources* pick
your account; under *Zone Resources* pick `kidscorner.mu` (or All zones if it is
not listed yet).

Copy the token when it is shown — Cloudflare will not show it twice.

---

## 4 · Four repository secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**, four times:

| Secret | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | your `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your `.env.local` |
| `CLOUDFLARE_ACCOUNT_ID` | step 2 |
| `CLOUDFLARE_API_TOKEN` | step 3 |

### Why the Supabase keys are *build* secrets and not Worker secrets

Anything prefixed `NEXT_PUBLIC_` is inlined by Next at **build** time. A value
set on the Worker afterwards arrives too late — the bundle already contains
whatever was present when it was built.

This matters more than it sounds. `lib/env.ts` deliberately tolerates a missing
configuration so `npm run dev` works before `.env.local` is filled in, and the
middleware acts on that:

```ts
if (!isSupabaseConfigured) return NextResponse.next()
```

Every request waved through — no login, no role check. A build without those
two secrets would deploy a site that looks completely normal and is completely
open. `scripts/preflight.mjs` refuses to build in that state, and the workflow
runs it before every deploy. Do not remove it.

---

## 5 · First deploy

Push to `main`, or run the workflow by hand: repo → **Actions** → *Deploy to
Cloudflare Workers* → **Run workflow**.

It typechecks, lints, runs the tests, preflights, builds and deploys.

**Check:** the run is green, and the log ends with a URL like
`https://kidscorner.<your-subdomain>.workers.dev`. Keep that URL — the next
three steps use it.

If the build fails on the preflight step, a secret in step 4 is missing or
malformed. That is the guard doing its job.

---

## 6 · Tell Supabase about the new origin

**This is the step that catches people.** Login works perfectly on localhost and
fails in production without it.

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** the `workers.dev` URL from step 5
- **Redirect URLs:** add both
  - `https://kidscorner.<your-subdomain>.workers.dev/**`
  - `https://kidscorner.mu/**` — add it now so nothing changes later

---

## 7 · Test on the workers.dev URL

Before any customer sees it:

- [ ] `/login` loads and signs you in
- [ ] `/dashboard` shows real figures
- [ ] `/products` lists the catalogue
- [ ] `/reports` → **Sales journal** — net + VAT = gross
- [ ] `/pos` opens the till
- [ ] A test sale completes, and the stock moves
- [ ] Sign out, then try `/dashboard` directly — it must bounce to `/login`

That last one is the important one. It proves auth is being enforced and the
build picked up the Supabase keys.

---

## 8 · Point the Android till at it

Test builds only — the release build already targets `https://kidscorner.mu`.

`till-android/app/build.gradle.kts`, in the `debug` block:

```kotlin
buildConfigField("String", "API_ORIGIN", "\"https://kidscorner.<subdomain>.workers.dev\"")
```

Rebuild, install, sign in with a PIN, ring up a sale. Then put it back to
`http://10.0.2.2:3001` for local work.

---

## 9 · Nameservers (the slow one)

At **Mauritius.biz**, change the nameservers for `kidscorner.mu` to the two
Cloudflare gives you under the domain's **Overview** page.

Propagation is usually an hour or two, sometimes 24. Cloudflare emails you when
the zone goes active. Nothing else has to wait for this — the site is already
live on `workers.dev`.

---

## 10 · Custom domain

Once the zone is active: Cloudflare dashboard → **Workers & Pages** →
`kidscorner` → **Settings** → **Domains & Routes** → **Add** → **Custom
Domain** → type `kidscorner.mu`.

Because the zone is in your account, Cloudflare writes the DNS record itself.
There is no "Add record" form to fill in, no IP address, no CNAME to copy.

**Check:** `https://kidscorner.mu` serves the site with a valid certificate.
Then re-run the step 7 list against the real domain, and confirm the Android
**release** build can reach it.

---

## Everyday use

| Command | What it does |
| --- | --- |
| `npm run dev` | local dev server |
| `npm test` | the money-core unit tests |
| `npm run cf:build` | preflight + production build for Workers |
| `npm run cf:preview` | run the built Worker locally under wrangler |
| `npm run cf:deploy` | build and deploy from this machine |

Prefer pushing to `main` over `cf:deploy` — CI runs the checks first, and
OpenNext does not guarantee Windows support. The build does work on Windows
today; "works today" is not what a shop's website should depend on.

---

## Known quirks

**`middleware.ts`, not `proxy.ts`.** Next 16 renamed the convention and runs a
`proxy.ts` on the Node runtime; the Cloudflare adapter only accepts edge
middleware, and Next refuses to put a `proxy.ts` on the edge. The deprecated
`middleware.ts` name still takes `runtime: "experimental-edge"`, which is what
the adapter needs. Every build prints a deprecation warning as a result. When
the adapter supports Node middleware this can move back.

**`nodejs_compat` is not optional.** `lib/pos/pin.ts` uses `Buffer` to pack the
PBKDF2 salt and hash into one column. Without the flag every cashier PIN check
fails.

**No cache bindings.** Every route is `force-dynamic` — each back-office page
depends on who is asking, each till page on the state of the drawer — so there
is no ISR cache to configure in `open-next.config.ts`.
