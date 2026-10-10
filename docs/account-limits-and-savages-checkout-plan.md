# Account limits and the AI FOR SAVAGES checkout: build plan

Status: plan, written Oct 8 2026. Nothing in it is built yet.

It is written for an implementing agent. Follow it in order and do exactly what each step says. Every fact in sections 2 and 3 was checked against the code, the production database or Stripe's live docs on Oct 8 2026, so do not re-research them.

---

## Summary for the founder

| You asked | What gets built |
|---|---|
| The $20 plan lets you add 10 accounts, and it must be enforced | A workspace on Pro can hold **10 accounts in total, across all platforms**. The server refuses the 11th; the Accounts page shows "7 of 10 accounts" and turns Connect off at 10. Reconnecting an account you already have always works. |
| AI FOR SAVAGES members can connect up to 100 | When the workspace owner is a member, the limit is **100**. At 10, a Pro user sees a "join AI FOR SAVAGES" offer with one button per plan, and each button goes straight to Stripe. |
| A second payment option on the landing, beautifully designed, going to the actual AI FOR SAVAGES Stripe page | An **AI FOR SAVAGES card** under the Pro card in the new landing's payment section, built in AI FOR SAVAGES' own look: the light that travels round the card's edge, the star-field sky, the silver price, the glowing cyan button and Sina's six perks with their colored icon tiles. Its button opens Stripe Checkout for the AI FOR SAVAGES price: $59.99/month, $599.99/year or $2,000 once. |
| When they pay, they're recorded in AI FOR SAVAGES' database and Posterract's | The moment Stripe confirms the money, the AI FOR SAVAGES server records the buyer in the shared people list. That record gives them a Posterract account and workspace, plus the AI FOR SAVAGES membership the AI FOR SAVAGES site checks. Stripe then sends them to a Posterract welcome page that says "You're in." and has them create their Posterract login with the same email. |

Nobody loses anything. Today only one workspace has more than 10 accounts (it has 15), and its owner is an AI FOR SAVAGES member, so the new limit for that workspace is 100.

---

## 0. Before you touch anything

### 0.1 Rules (from AGENTS.md and the founder; none of them bend)

1. **Never deploy to Vercel.** Production is the Docker Compose stack on the VPS (`root@100.93.122.0`).
2. **Never print, log, paste or commit a secret.** That covers API keys, `.env` values, Stripe keys and the Hub service key. When a value has to move between files on the VPS, move it with a command that never shows it (step 8.3 has the exact command).
3. **Do not commit or push** until the founder has seen production and says so (section 11).
4. **Touch only the files this plan lists** (Appendix A). Other agents work in this same checkout. Run `git status --short` before you start and leave every file you did not create or edit exactly as it was.
5. **The new landing is unfinished work and stays uncommitted.** It covers `apps/web/src/marketing/game/*`, `apps/web/src/styles/game.css`, `apps/web/public/brand/game/*`, `apps/web/preview-game/*` (excluded from git), `apps/web/src/marketing/Landing.tsx`, `RoadmapTerminal.tsx`, `agency/index.tsx`, `docs/landing-game-plan.md` and `.claude/launch.json`. You edit some of them, but you never commit or deploy them.
6. **The Pro card is approved. Change only its account line** (step 5.6). Do not restyle it, move it, or make the two cards look alike. The founder treats approved elements as finished, and making two tiles match has backfired before.
7. **Do not touch the AI FOR SAVAGES website repo** (`~/CODING PROJECTS/aiforsavages-community` and its copies), apart from the read-only `git show` in step 5.1 that copies two images out of it.
8. **Never run the Hub's existing test files** (`apps/hub/test/billing.test.js` and the others). They need a real database, and the only real one is production. Run only the new PGlite test from Phase 2.
9. **No timelines, no extra steps for users, no trials.** Posterract is paid-only.
10. **Never enter card details or make a purchase.** Only the founder can do a real purchase test (step 9.6).
11. **Report honestly.** If a test fails, say so and show the output.

### 0.2 Words used in this plan

| Word | Meaning |
|---|---|
| **Posterract API** | `apps/api`, the `api` container. |
| **Hub** | `apps/hub`: the AI FOR SAVAGES membership server. It is its own container (`aiforsavages-hub-1`), at `api.aiforsavages.fyi` publicly and `http://hub:3003` inside the VPS's Docker network. |
| **AFS site** | `www.aiforsavages.fyi`, a Next.js app on Vercel in its own repo. Not touched. |
| **AFS** | AI FOR SAVAGES. |
| **Guest checkout** | Buying AFS from Posterract's landing page by someone with no Posterract login. The email they type on Stripe's page decides who they are. |
| **Member checkout** | Buying AFS from inside the Posterract app, signed in. The membership lands on the signed-in person. |
| **Slot** | One social account counted against the limit. |

### 0.3 How the steps are written

Each step gives a **File**, then **Find** (exact current text) and **Replace with**, or a full new file. Then comes a **Check**. If a **Find** text is not in the file exactly, stop: someone changed the file. Show the founder the difference and do not guess.

---

## 1. What the founder asked for

### 1.1 His words (Oct 8 2026)

> "can you add a payment plan and update the payment section - the $20 a month plan lets you add 10 differnt accounts ... enforce that because it is not enforced .... but all AI FOR SAVAGE members can connect up to 100 accounts - can you add that into the code AND.... I want you to beautifully design another payment option on the payment part that directs people to the payment page for AI FOR SAVAGES.... the actual STRIPE page.... when they pay - they get recorded as a usr for AI FOR SAVAGES in the AI FOR SAVAGES database AND the posterract database too"

Then: "i prefer you actually use ai for savage themes to make it stand out in the payment section".

### 1.2 Decisions already made (do not re-ask him)

1. **"10 different accounts" means 10 in total per workspace, across every platform.** For example, 4 Instagram + 3 TikTok + 3 Threads. The code today caps each platform at 10, which allows 60, and that is the hole he means. If he later says "10 per platform", change only `ACCOUNT_LIMITS` and the counting query in `accountLimits.js`.
2. **AFS members get 100 in total**, also across every platform. The per-platform cap of 10 is removed: it would stop a member at 60.
3. **What takes a slot:** an account with a real platform id that is not disconnected. That includes `connected` and `needs_reauth`. The six empty placeholder rows every workspace starts with never count.
4. **Reconnecting an account that already holds a slot is always allowed**, even at the limit. Bringing back an account that was disconnected needs a free slot.
5. **Nobody loses accounts.** A workspace already over its limit keeps everything, but can't add more until it's under. Today no Pro workspace is over 10.
6. **Who counts as a member** is the same rule Posterract uses for access today. The workspace **owner** has a verified email (`app_users.email_verified = true`) and `core.has_membership(owner, 'aiforsavages')` is true.
7. **The AFS card lives on the new landing** (`EnterTheGame.tsx`), in AFS's own look, as its own element below the Pro panel. The Pro panel keeps its layout and look; only its account line changes, from "100 accounts on each platform" to "10 accounts".
8. **The live landing (`ruixen-pricing-04.tsx`) also says "Connect up to 100 accounts on each platform" for Pro.** Once 10 is enforced, that line would be false. Change that one line to "Connect up to 10 accounts" and nothing else on the live landing.
9. **The button goes straight to the actual Stripe Checkout page** for the AFS price. It does not go through the AFS website.
10. **One database holds both "databases"** (section 2.1). "Recorded in AFS's database and Posterract's" means one transaction writes the person, their Posterract workspace and their AFS membership.
11. **At the limit, a Pro user is offered AFS in the app**, with one button per plan straight to Stripe. That is the only new place AFS is sold. There are no new banners and no upsell anywhere else.

---

## 2. How things work today (verified Oct 8 2026)

### 2.1 One database, two products

- Posterract and the Hub share one Postgres (`posterract-postgres-1`).
- **A person is one row in `public.app_users`.** The Hub calls this "the single people list" and the AFS site calls it the same.
- Posterract-only tables: `workspaces`, `workspace_memberships`, `social_accounts` (with 6 placeholder rows per workspace: `status = 'disconnected'`, `handle = 'not connected'`, `provider_account_id` null), `billing_*`.
- AFS tables are in schema `core`:
  - `core.memberships` (`plan` ∈ founding/monthly/yearly/lifetime/comp; `status` ∈ active/past_due/canceled/expired/refunded; `source` ∈ legacy_one_time/stripe_subscription/stripe_one_time/manual; `stripe_subscription_id` is **unique**; at most one live membership per person)
  - `core.identities` (Clerk logins)
  - `core.billing_events` (the Hub's Stripe idempotency ledger)
  - `core.review_queue` (things Sina must decide)
- **The rule:** `core.has_membership(account uuid, 'aiforsavages')`.
- The Hub connects as the database role `hub`. It has `select, insert, update` on `app_users`, `workspaces`, `workspace_memberships` and `social_accounts`, and full rights on `core.*`.
- `apps/hub/src/provisioning.js` `findOrCreatePerson(client, { email, displayName, imageUrl })` finds a person by lower-cased email or creates them. When it creates one, it also gives them a Posterract workspace, the owner membership and the 6 placeholders, exactly like a Posterract sign-up. It does **not** set `email_verified` or `auth_user_id`, on purpose.
- **The AFS site no longer keeps members anywhere else.** Its middleware asks the Hub (`checkMembership` → `/v1/me`), "the only authority on membership". Its old Supabase table is not consulted for membership and is not written by this plan.

### 2.2 Who may use Posterract

`apps/api/src/billing.js` `loadSubscription` grants Posterract when one of these holds:
- a recognized Pro subscription is active, or
- the workspace owner has `email_verified = true` **and** `core.has_membership(owner, 'aiforsavages')`. The result is reported as `entitledVia: "aiforsavages"`.

### 2.3 AFS billing lives in the Hub

- `apps/hub/src/billing.js`:
  - `PRICES`: monthly, yearly and lifetime from `AFS_STRIPE_PRICE_*`.
  - `createCheckout({ accountId, plan, successUrl, cancelUrl })`: for a known person. It refuses existing members, makes the Hub's own Stripe customer, sets metadata `account_id`, accepts cards only, and runs the redirects through `siteUrl()`, which today allows only the AFS site.
  - `handleStripeEvent`: an idempotent webhook. It handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`, `charge.refunded` and `charge.dispute.created`. It acts only on AFS price ids, and it finds the person through `accountIdFrom()` (metadata `account_id`, `client_reference_id`, a known customer, or the customer's own metadata).
  - `upsertMembership(client, …)`: the one way a membership is written.
- **Live AFS prices**, read from Stripe on Oct 8 2026. All are active, in USD, on product `prod_SWQNKdZGdbt4uP`:

| Plan | Amount | Type |
|---|---|---|
| monthly | 5999 ($59.99) | recurring, month |
| yearly | 59999 ($599.99) | recurring, year |
| lifetime | 200000 ($2,000) | one-time |

- The Hub runs as compose project `aiforsavages` from `/srv/aiforsavages/source/deploy/aiforsavages/compose.yaml`, with env file `/srv/aiforsavages/.env`. It is joined to `posterract_posterract-network` with the alias **`hub`**, so the Posterract API container reaches it at **`http://hub:3003`**. The live Hub source matched this repo byte for byte on Oct 8 (md5 of `billing.js`, `server.js`, `provisioning.js` and `accounts.js`).
- The Hub's service routes use `requireService` (`Authorization: Bearer HUB_SERVICE_KEY`). `HUB_SERVICE_KEY` is in `/srv/aiforsavages/.env`. **`/srv/posterract/.env` has no `HUB_*` keys yet.**

### 2.4 Stripe: one account, four webhooks

The same Stripe account serves Posterract, AFS and others. These are its webhook endpoints, as listed on Oct 8:

| Endpoint | Events | What it does with an AFS checkout from this plan |
|---|---|---|
| `api.aiforsavages.fyi/v1/webhooks/stripe` (Hub) | checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted, charge.dispute.created, charge.refunded | **Records it** (new code in Phase 2) |
| `api.posterract.app/v1/webhooks/stripe` (Posterract) | checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, checkout.session.expired | Ignores it: it finds no Posterract workspace, because nothing carries `workspace_id`, and an app_users id in `client_reference_id` is not a workspace id |
| `www.aiforsavages.fyi/api/webhooks/stripe` (old AFS site) | checkout.session.completed, async_payment_succeeded/failed, expired | Ignores it **only as long as the session metadata has no `userId` and no `tier`**. Never add those keys. |
| `drnumerology.xyz/…` | (disabled) | — |

Stripe facts this plan relies on (checked against docs.stripe.com on Oct 8):
- In `subscription` mode, Checkout always creates a Customer. In `payment` mode it creates one only with `customer_creation: "always"`.
- `customer_details.email` on a completed session is the email the buyer typed.
- `success_url` may contain the literal `{CHECKOUT_SESSION_ID}`, which Stripe fills in.
- Stripe waits **up to 10 seconds** for webhook endpoints that listen to `checkout.session.completed` before it redirects to `success_url`. The webhook has usually run by the time the welcome page loads.
- Stripe says to fulfil from the webhook **and** from the success page, safely, more than once. Fulfilment from the page alone is not reliable.
- `checkout.sessions.list({ subscription })` returns the session for a subscription.
- Metadata: at most 50 keys, keys up to 40 characters, values up to 500. Updating metadata merges keys.
- `custom_text.submit.message` takes up to 1,200 characters.

### 2.5 Connecting accounts today

- **`apps/api/src/oauth.js` `saveConnection()` is the only place a social account is added.** Both OAuth `complete` and Facebook `select-page` call it.
- It locks the workspace row, then refuses a new account when the workspace already has 10 `connected` accounts **on that platform**. That cap is per platform, and it ignores `needs_reauth`.
- The orchestrator marks broken accounts `needs_reauth`. Disconnecting sets `status = 'disconnected'` and keeps `provider_account_id`. Meta data deletion turns the row back into a placeholder.
- Statuses in use: `connected`, `needs_reauth`, `disconnected`.
- The web Accounts page (`apps/web/src/routes/_app/portals.tsx`) says "Up to 10 accounts per network" and disables a platform's button at 10 on that platform.
- `GET /v1/bootstrap` feeds the web app's account list (`portals`). `GET /v1/accounts` is the agent API's list.

### 2.6 The two landings

- **Live today:** `apps/web/src/marketing/Landing.tsx`, whose pricing comes from `components/ui/animated-pricing-card.tsx` → `ruixen-pricing-04.tsx`.
- **New, unfinished:** `apps/web/src/marketing/game/GameLanding.tsx`. Its payment section is `EnterTheGame.tsx` (section id `enter`, the Pro panel `.g-panel.g-plan`), styled by `apps/web/src/styles/game.css`.
  - No route renders it yet.
  - The founder views it through `apps/web/preview-game/` (`index.html` + `main.tsx`, excluded from git in `.git/info/exclude`), served by the `game-demo` (port 5189) or `game-preview` (port 5188) entries in `.claude/launch.json`.
  - The preview passes fixed prices: `prices={{ monthly: 2000, yearly: 20000 }}`.
- In production the web app calls its API **on the same origin**: `VITE_API_URL=/api`, so `posterractApiUrl` is `https://www.posterract.app`. The Caddy gateway sends `/v1/*` and `/api/v1/*` to the API, so no CORS is needed.

### 2.7 Sign-in facts the design relies on

- better-auth lower-cases emails for password sign-ups (`sign-up.mjs`) and for Google sign-ups (`link-account.mjs`).
- The sign-up hook in `apps/api/src/auth.js` does `insert into app_users … on conflict (email) do update set auth_user_id = …, email_verified = …`. So **a person the Hub created gets claimed by whoever signs up to Posterract with that email.** The hook reuses their existing workspace and placeholders.
- Email + password sign-up needs email verification. After verification, `email_verified` becomes true. Google sign-up is verified at once.
- The magic link sign-in only works for an existing, verified Posterract login. It never creates one.
- On the AFS site, signing in with Clerk on the same verified email links that login to the same person (`apps/hub/src/accounts.js` `resolveAccount`).

### 2.8 Production numbers (read-only queries, Oct 8 2026)

| | Count |
|---|---|
| Workspaces with at least one account holding a slot | 7 |
| Workspaces over 10 | 1, which is an AFS workspace with 15 accounts |
| Pro workspaces over 10 | 0 |
| Workspaces whose owner qualifies as an AFS member | 52 |
| Workspaces with an active Pro subscription | 5 |

---

## 3. The design

### 3.1 The account limit

- A new file `apps/api/src/accountLimits.js` holds the numbers (`pro: 10`, `aiforsavages: 100`), the plan check, the slot count, `accountLimitFor()` and `AccountLimitError`.
- `saveConnection()` replaces the per-platform cap with the workspace limit (rules 1.2.3 and 1.2.4).
- `GET /v1/bootstrap` and `GET /v1/accounts` return `accountLimit: { plan, max, used }`.
- The web Accounts page shows "{used} of {max} accounts", turns Connect and Add account off at the limit, keeps Reconnect on, and at the limit shows the notice from 3.3.
- OAuth `complete` and Facebook `select-page` return `{ ok: false, code: "account_limit_reached", error: <message>, accountLimit }`. The callback page titles it "Account limit reached".

### 3.2 Buying AFS from the landing (guest checkout)

1. The visitor picks Monthly, Yearly or Lifetime on the AFS card, then clicks **Join AI FOR SAVAGES**.
2. The browser calls `POST /v1/savages/checkout { plan }` on Posterract's own origin. This route is public and rate-limited.
3. The Posterract API calls the Hub at `POST http://hub:3003/v1/service/posterract/checkout { plan }` with the Hub service key.
4. The Hub creates a Stripe Checkout Session:
   - metadata `{ product: "aiforsavages", plan, flow: "posterract_guest" }`, also on the subscription or payment intent;
   - cards only; `customer_creation: "always"` for lifetime;
   - `success_url = https://www.posterract.app/savages?session_id={CHECKOUT_SESSION_ID}`, `cancel_url = https://www.posterract.app/#enter`.
5. The browser goes to `session.url`, which is **the actual Stripe page**.
6. The buyer pays, and Stripe calls the Hub's webhook. `checkout.session.completed` with `flow = posterract_guest` runs `fulfillGuestCheckout()`, in one transaction:
   1. It reads the session back from Stripe (paid? our price? which email?).
   2. It inserts `core.billing_events` row `guest:<session id>`, which makes the purchase count once.
   3. `findOrCreatePerson(email)` writes the **person + Posterract workspace**.
   4. If they already have a live membership, it changes nothing, parks a review and stops.
   5. It tags the Stripe customer and subscription with `account_id`, so renewals, cancels and refunds find the person.
   6. `upsertMembership()` writes the **AFS membership**.
7. Stripe redirects the buyer to `/savages?session_id=…`. The page asks `GET /v1/savages/checkout/:sessionId`. That reaches the Hub, which runs the same fulfilment if the webhook hasn't yet (it is safe twice) and answers `{ state, email, plan, hasPosterractLogin }`.
8. The page says **"You're in."** with the email, then shows the Posterract sign-up card **prefilled with that email** (or sign-in, if that email already has a login), plus a button to the AFS site.
9. They sign up. better-auth claims the person row. Once the email is verified they are entitled through AFS and their workspace limit is 100.

### 3.3 Buying AFS from inside the app (member checkout)

At the limit on Pro, the Accounts page shows: "All 10 of your Pro account slots are in use. Disconnect one to add another, or join AI FOR SAVAGES to connect up to 100." It has three buttons: **$59.99/mo**, **$599.99/yr** and **$2,000 once**.

1. A button calls `POST /v1/savages/checkout/member { plan }` (signed in, owner only).
2. The API calls the Hub with `{ plan, accountId: <their app_users id> }`.
3. The Hub runs the **existing** `createCheckout()`: it makes their own AFS customer (email prefilled and locked on Stripe's page) and sets metadata `account_id`, with `success_url = /portals?savages=joined` and `cancel_url = /portals`.
4. The existing webhook path records the membership on them.
5. Back on `/portals?savages=joined`, the page says "Welcome to AI FOR SAVAGES" and reloads the workspace, so the limit shows 100.

### 3.4 What gets recorded where

| Record | Where | Read by |
|---|---|---|
| The person | `public.app_users` (email lower-cased) | Both products. It is the shared people list. |
| Their Posterract workspace | `workspaces`, `workspace_memberships`, 6 `social_accounts` placeholders | Posterract |
| The AFS membership | `core.memberships` (`plan`, `status`, Stripe ids, period) | The AFS site (through the Hub's `/v1/me`), Posterract access (`entitledVia: "aiforsavages"`) and the 100-account limit |
| The payment, counted once | `core.billing_events`, id `guest:<session id>` | The Hub |
| Their Posterract login | better-auth tables + `app_users.auth_user_id` | Created when they sign up on the welcome page |
| Their AFS login | Clerk + `core.identities` | Created the first time they sign in on aiforsavages.fyi with the same email |
| Who the Stripe objects belong to | Stripe metadata `account_id` on the customer and subscription | The Hub, on every later event |

### 3.5 Why the email from Stripe is safe to trust

A membership attached to an email reaches only someone who proves that email:
- Posterract counts it only when `app_users.email_verified` is true, which only Posterract's own login can set.
- The AFS site counts it only after Clerk has verified the email (`resolveAccount`).

Paying with someone else's address only gives that person a membership. This is the same rule the Hub's legacy bridge follows.

### 3.6 Edge cases

| Case | What happens |
|---|---|
| The webhook is late or lost | The welcome page fulfils it. `invoice.paid` also fulfils a guest subscription whose session event was ignored. |
| The webhook and the welcome page arrive together | The `guest:<id>` row lets exactly one write anything. The other answers "duplicate". |
| A subscription whose first payment is still settling | Nothing is written until it is active. The page keeps showing "Confirming". |
| The buyer typed an email that already has a Posterract login | The membership lands on that existing person. The page offers **Sign in** instead of Create account. |
| The buyer was already an AFS member and paid again | Nothing changes. A `guest_checkout_already_member` review is parked for Sina, the new Stripe subscription is left untagged so its renewals are ignored too, and the page says so. Sina refunds or cancels it in Stripe. |
| Stripe returned no email | Nothing is granted. One `guest_checkout_no_email` review is parked, and the page shows the support email. |
| The buyer signs up with Google on a different Google account | That makes a separate Posterract login with no membership. The page says to use Google only if the Google account is that email. |
| A Pro subscriber joins AFS | They have both and keep paying the $20 until they cancel it. Nothing auto-cancels it. Tell the founder; don't build anything for it. |
| A team member who isn't the owner clicks the in-app upgrade | Refused with `owner_only`, because the limit follows the owner's membership. |
| A reconnect at the limit | Allowed, as long as the account still holds its slot. |
| An old Mac app (0.2.8) | It doesn't read `accountLimit`. The server still refuses the 11th account, and the browser callback page shows the message. |

### 3.7 Diagram

```mermaid
sequenceDiagram
  participant V as Visitor
  participant W as www.posterract.app (web)
  participant A as Posterract API
  participant H as Hub (http://hub:3003)
  participant S as Stripe
  participant D as Postgres
  V->>W: Join AI FOR SAVAGES (Monthly)
  W->>A: POST /v1/savages/checkout {plan}
  A->>H: POST /v1/service/posterract/checkout (service key)
  H->>S: checkout.sessions.create (flow=posterract_guest)
  S-->>V: Stripe Checkout page
  V->>S: pays
  S->>H: webhook checkout.session.completed
  H->>D: billing_events guest:id, app_users + workspace, core.memberships
  H->>S: tag customer + subscription with account_id
  S-->>V: redirect /savages?session_id=…
  W->>A: GET /v1/savages/checkout/:id
  A->>H: POST /v1/service/posterract/checkout-status
  H-->>W: {state: active, email, plan}
  V->>W: creates Posterract login with that email
```

### 3.8 Approaches already ruled out (don't switch to them)

- **Stripe Payment Links.** Their metadata does not reach the session, and their success page can't be shared with the member path.
- **Posterract's API creating AFS sessions with its own Stripe key.** That splits AFS billing out of the Hub, which is the only authority on membership.
- **Pre-creating a Clerk user at purchase.** Nothing needs it: the first AFS sign-in with the same email links them.
- **Sending them to the AFS site's pricing.** He asked for the actual Stripe page.

---

## 4. Phase 1: account limits in the Posterract API

### 4.1 New file `apps/api/src/accountLimits.js`

```js
/**
 * How many social accounts a workspace may connect, across every platform.
 *
 *   Pro ($20 a month or $200 a year)                      10 accounts
 *   the workspace owner is an AI FOR SAVAGES member       100 accounts
 *
 * "Member" is the rule billing.js uses for access: the owner's email is
 * verified and core.has_membership says yes.
 *
 * A slot is any real account that is not disconnected: connected, or waiting
 * for a reconnect (needs_reauth). The empty per-platform placeholders a
 * workspace starts with never take one.
 *
 * The limit is checked only when an account would take a NEW slot, so
 * reconnecting an account that already holds one always works. A workspace
 * already over its limit keeps every account; it just cannot add one until
 * it is under.
 */

export const ACCOUNT_LIMITS = Object.freeze({ pro: 10, aiforsavages: 100 });

/** "aiforsavages" when the workspace owner is a member, otherwise "pro". */
export async function accountPlanFor(db, workspaceId) {
  try {
    const result = await db.query(
      `select exists (
         select 1
         from workspaces w
         join app_users u on u.id = w.owner_id
         where w.id = $1
           and u.email_verified = true
           and core.has_membership(u.id, 'aiforsavages')
       ) as member`,
      [workspaceId],
    );
    return result.rows[0]?.member === true ? "aiforsavages" : "pro";
  } catch {
    // The core schema is missing or unreadable: Pro's limit stands, the same
    // fallback billing.js uses for access.
    return "pro";
  }
}

/** Accounts holding a slot right now. */
export async function usedAccountSlots(db, workspaceId) {
  const result = await db.query(
    `select count(*)::int as used
     from social_accounts
     where workspace_id = $1
       and provider_account_id is not null
       and status <> 'disconnected'`,
    [workspaceId],
  );
  return Number(result.rows[0]?.used ?? 0);
}

/** The workspace's limit as the web app and the API show it. */
export async function accountLimitFor(db, workspaceId) {
  const [plan, used] = await Promise.all([
    accountPlanFor(db, workspaceId),
    usedAccountSlots(db, workspaceId),
  ]);
  return { plan, max: ACCOUNT_LIMITS[plan], used };
}

export class AccountLimitError extends Error {
  constructor(limit) {
    super(
      limit.plan === "aiforsavages"
        ? `All ${limit.max} of your account slots are in use. Disconnect an account to add another.`
        : `Pro connects up to ${limit.max} accounts, and all ${limit.max} are in use. Disconnect one to add another, or join AI FOR SAVAGES to connect up to ${ACCOUNT_LIMITS.aiforsavages}.`,
    );
    this.name = "AccountLimitError";
    this.code = "account_limit_reached";
    this.accountLimit = limit;
  }
}
```

**Check:** `node --check apps/api/src/accountLimits.js` prints nothing.

### 4.2 `apps/api/src/oauth.js`: import

Add this line directly after the last `import … from …;` statement at the top of the file:

```js
import { ACCOUNT_LIMITS, AccountLimitError, accountPlanFor, usedAccountSlots } from "./accountLimits.js";
```

### 4.3 `apps/api/src/oauth.js`: `saveConnection` uses the workspace limit

**Find:**

```js
export async function saveConnection(database, workspaceId, provider, connection) {
  const client = await database.connect();
  try {
    await client.query("begin");
    // Serialize account additions within the workspace so concurrent OAuth
    // callbacks cannot race past the ten-account provider cap.
    await client.query("select id from workspaces where id = $1 for update", [workspaceId]);
    const existing = await client.query(
      `select id from social_accounts
       where workspace_id = $1 and provider = $2 and provider_account_id = $3
       limit 1 for update`,
      [workspaceId, provider, connection.providerAccountId],
    );
    let accountId = existing.rows[0]?.id;
    if (!accountId) {
      const count = await client.query(
        `select count(*)::int as count from social_accounts
         where workspace_id = $1 and provider = $2 and status = 'connected'`,
        [workspaceId, provider],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 10) {
        const error = new Error(`You can connect up to 10 ${provider} accounts.`);
        error.code = "account_limit_reached";
        throw error;
      }
      const placeholder = await client.query(
```

**Replace with:**

```js
export async function saveConnection(database, workspaceId, provider, connection) {
  // Read before the transaction: if the core schema were unreadable, the
  // failed query would abort the transaction and the fallback to Pro could
  // never run.
  const plan = await accountPlanFor(database, workspaceId);
  const client = await database.connect();
  try {
    await client.query("begin");
    // Serialize account additions within the workspace so concurrent OAuth
    // callbacks cannot race past the workspace's account limit.
    await client.query("select id from workspaces where id = $1 for update", [workspaceId]);
    const existing = await client.query(
      `select id, status from social_accounts
       where workspace_id = $1 and provider = $2 and provider_account_id = $3
       limit 1 for update`,
      [workspaceId, provider, connection.providerAccountId],
    );
    let accountId = existing.rows[0]?.id;
    // Reconnecting an account that already holds a slot is always allowed. A
    // new account, or a disconnected one coming back, needs a free slot.
    const holdsSlot = Boolean(existing.rows[0]) && existing.rows[0].status !== "disconnected";
    if (!holdsSlot) {
      const used = await usedAccountSlots(client, workspaceId);
      if (used >= ACCOUNT_LIMITS[plan]) {
        throw new AccountLimitError({ plan, max: ACCOUNT_LIMITS[plan], used });
      }
    }
    if (!accountId) {
      const placeholder = await client.query(
```

Everything after that line stays exactly as it is.

### 4.4 `apps/api/src/oauth.js`: OAuth `complete` says why

In the route `"/v1/oauth/:provider/complete"`:

**Find:**

```js
      } catch (error) {
        request.log.warn({ err: error, provider }, "OAuth completion failed");
        return {
          ok: false,
          returnTo,
          error: error instanceof Error ? error.message : "Connection failed",
        };
      }
```

**Replace with:**

```js
      } catch (error) {
        request.log.warn({ err: error, provider }, "OAuth completion failed");
        return {
          ok: false,
          returnTo,
          error: error instanceof Error ? error.message : "Connection failed",
          ...(error instanceof AccountLimitError
            ? { code: error.code, accountLimit: error.accountLimit }
            : {}),
        };
      }
```

### 4.5 `apps/api/src/oauth.js`: Facebook `select-page` says why too

In the route `"/v1/oauth/facebook/select-page"`:

**Find:**

```js
      await saveConnection(postgres, workspaceId, "facebook", {
        handle: page.name,
        displayName: page.name,
        providerAccountId: page.id,
        accessToken: page.accessToken,
        refreshToken: pending.userAccessToken,
        expiresAt: pending.expiresAt,
        providerUserId: page.id,
        providerAuthUserId: pending.authUserId,
        avatarUrl: page.avatarUrl,
        scopes: FACEBOOK_PAGE_SCOPES,
      });
```

**Replace with:**

```js
      try {
        await saveConnection(postgres, workspaceId, "facebook", {
          handle: page.name,
          displayName: page.name,
          providerAccountId: page.id,
          accessToken: page.accessToken,
          refreshToken: pending.userAccessToken,
          expiresAt: pending.expiresAt,
          providerUserId: page.id,
          providerAuthUserId: pending.authUserId,
          avatarUrl: page.avatarUrl,
          scopes: FACEBOOK_PAGE_SCOPES,
        });
      } catch (error) {
        if (!(error instanceof AccountLimitError)) throw error;
        return {
          ok: false,
          error: error.message,
          code: error.code,
          accountLimit: error.accountLimit,
          returnTo: pending.returnTo === "desktop" ? "desktop" : "web",
        };
      }
```

### 4.6 `apps/api/src/server.js`: show the limit

1. Add near the other `./…js` imports at the top:

```js
import { accountLimitFor } from "./accountLimits.js";
```

2. In the `GET /v1/accounts` route, **Find:**

```js
    const workspaceId = requiredWorkspace(request);
    const result = await postgres.query(
      `select id, provider, provider_account_id, handle, display_name,
              avatar_url, status, scopes, token_expires_at,
              last_health_check_at, metadata
       from social_accounts
       where workspace_id = $1
       order by array_position($2::text[], provider), created_at asc`,
      [workspaceId, PLATFORM_IDS],
    );
    return {
```

**Replace with:**

```js
    const workspaceId = requiredWorkspace(request);
    const [result, accountLimit] = await Promise.all([
      postgres.query(
        `select id, provider, provider_account_id, handle, display_name,
                avatar_url, status, scopes, token_expires_at,
                last_health_check_at, metadata
         from social_accounts
         where workspace_id = $1
         order by array_position($2::text[], provider), created_at asc`,
        [workspaceId, PLATFORM_IDS],
      ),
      accountLimitFor(postgres, workspaceId),
    ]);
    return {
      accountLimit,
```

The `accounts: result.rows.map(…)` part that follows stays exactly the same.

3. In the `GET /v1/bootstrap` route there are three small edits.

   (a) The destructuring list. **Find:**

```js
      accountsResult,
      businesses,
      points,
    ] =
```

   **Replace with:**

```js
      accountsResult,
      businesses,
      points,
      accountLimit,
    ] =
```

   (b) The end of its `Promise.all([...])`. **Find:**

```js
        loadBusinesses(postgres, workspaceId, { publicApiUrl: connectorApiUrl }),
        loadPointsSummary(postgres, workspaceId),
      ]);
```

   **Replace with:**

```js
        loadBusinesses(postgres, workspaceId, { publicApiUrl: connectorApiUrl }),
        loadPointsSummary(postgres, workspaceId),
        accountLimitFor(postgres, workspaceId),
      ]);
```

   (c) The end of the returned object. **Find:**

```js
      // Installed desktop apps from before businesses still read this.
      accountSets: [],
      points,
    };
```

   **Replace with:**

```js
      // Installed desktop apps from before businesses still read this.
      accountSets: [],
      points,
      accountLimit,
    };
```

4. In the OpenAPI list, change the summary text `"List connected social accounts"` to `"List connected social accounts and the workspace's account limit (accountLimit)"`.

**Check:** `node --check apps/api/src/oauth.js && node --check apps/api/src/server.js` prints nothing.

### 4.7 `packages/contract/src/index.ts`: the shared types

Insert this directly after the `BillingCheckoutDTO` type (after its closing `};`, before the `// Retry policy` comment block):

```ts
/**
 * How many social accounts a workspace may connect, across every platform:
 * 10 on Pro, 100 when the workspace owner is an AI FOR SAVAGES member.
 */
export type AccountLimitDTO = {
  plan: "pro" | "aiforsavages";
  max: number;
  /** Accounts holding a slot: connected, or waiting for a reconnect. */
  used: number;
};

/** AI FOR SAVAGES, sold from Posterract: the three ways to join. */
export type SavagesPlanId = "monthly" | "yearly" | "lifetime";

/** A plan's live Stripe price in cents. `interval` is null for lifetime. */
export type SavagesPlanDTO = {
  id: SavagesPlanId;
  amount: number;
  currency: "usd";
  interval: "month" | "year" | null;
};

/** Where a checkout from the landing page stands, for the welcome page after Stripe. */
export type SavagesCheckoutStatusDTO = {
  state: "pending" | "active" | "already_member" | "needs_help" | "invalid";
  /** The email typed on Stripe's page. The Posterract login must use it. */
  email?: string | null;
  plan?: SavagesPlanId | null;
  /** That email already has a Posterract login: sign in, don't sign up. */
  hasPosterractLogin?: boolean;
};
```

### 4.8 New test `apps/api/test/account-limits.test.js`

```js
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { AccountLimitError, accountLimitFor } from "../src/accountLimits.js";
import { saveConnection } from "../src/oauth.js";

/**
 * Pro connects 10 accounts in all, an AI FOR SAVAGES member's workspace 100;
 * a reconnect never counts against the limit, and nothing is ever taken away.
 */

process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");

async function database({ through } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()
    .filter((name) => !through || name <= through);
  for (const name of files) await db.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

/** A workspace exactly as sign-up makes one: an owner and six empty placeholders. */
async function workspaceFor(postgres, { email = "owner@example.test", verified = true } = {}) {
  const user = (await postgres.query(
    "insert into app_users (email, display_name, email_verified) values ($1, 'Owner', $2) returning id",
    [email, verified],
  )).rows[0];
  const workspace = (await postgres.query(
    "insert into workspaces (owner_id, name) values ($1, 'Workspace') returning id",
    [user.id],
  )).rows[0];
  for (const provider of ["instagram", "tiktok", "facebook", "threads", "x", "youtube"]) {
    await postgres.query(
      "insert into social_accounts (workspace_id, provider, handle, status) values ($1, $2, 'not connected', 'disconnected')",
      [workspace.id, provider],
    );
  }
  return { userId: user.id, workspaceId: workspace.id };
}

const connection = (id) => ({
  providerAccountId: id,
  handle: `@${id}`,
  accessToken: "access",
  refreshToken: "refresh",
  scopes: [],
  expiresAt: Date.now() + 86_400_000,
});

/** 4 Instagram + 3 TikTok + 3 Threads: Pro's ten. */
async function connectTen(postgres, workspaceId) {
  for (const [provider, count] of [["instagram", 4], ["tiktok", 3], ["threads", 3]]) {
    for (let index = 0; index < count; index += 1) {
      await saveConnection(postgres, workspaceId, provider, connection(`${provider}-${index}`));
    }
  }
}

async function makeMember(postgres, userId) {
  await postgres.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, current_period_end)
     values ($1, 'aiforsavages', 'monthly', 'active', 'manual', now() + interval '30 days')`,
    [userId],
  );
}

test("the empty placeholders never take a slot", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 0 });
});

test("Pro connects ten accounts in all, across every platform, and the eleventh is refused", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 10 });

  await assert.rejects(saveConnection(postgres, workspaceId, "facebook", connection("page-1")), (error) => {
    assert.ok(error instanceof AccountLimitError);
    assert.equal(error.code, "account_limit_reached");
    assert.deepEqual(error.accountLimit, { plan: "pro", max: 10, used: 10 });
    assert.match(error.message, /join AI FOR SAVAGES to connect up to 100/);
    return true;
  });
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10, "nothing was written");
});

test("reconnecting an account that already holds a slot works at the limit", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await saveConnection(postgres, workspaceId, "instagram", connection("instagram-0"));
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10);
});

test("an account waiting for a reconnect keeps its slot, and can be reconnected", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await postgres.query("update social_accounts set status = 'needs_reauth' where provider_account_id = 'tiktok-1'");
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 10);
  await assert.rejects(saveConnection(postgres, workspaceId, "facebook", connection("page-1")), AccountLimitError);
  await saveConnection(postgres, workspaceId, "tiktok", connection("tiktok-1"));
  const row = await postgres.query("select status from social_accounts where provider_account_id = 'tiktok-1'");
  assert.equal(row.rows[0].status, "connected");
});

test("disconnecting frees a slot, and bringing a disconnected account back needs one", async () => {
  const postgres = await database();
  const { workspaceId } = await workspaceFor(postgres);
  await connectTen(postgres, workspaceId);
  await postgres.query("update social_accounts set status = 'disconnected' where provider_account_id = 'tiktok-0'");
  assert.equal((await accountLimitFor(postgres, workspaceId)).used, 9);
  await saveConnection(postgres, workspaceId, "threads", connection("threads-new"));
  await assert.rejects(saveConnection(postgres, workspaceId, "tiktok", connection("tiktok-0")), AccountLimitError);
});

test("an AI FOR SAVAGES member's workspace connects up to 100", async () => {
  const postgres = await database();
  const { userId, workspaceId } = await workspaceFor(postgres);
  await makeMember(postgres, userId);
  await connectTen(postgres, workspaceId);
  await saveConnection(postgres, workspaceId, "facebook", connection("page-1"));
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "aiforsavages", max: 100, used: 11 });

  await postgres.query(
    `insert into social_accounts (workspace_id, provider, provider_account_id, handle, status)
     select $1::uuid, 'instagram', 'bulk-' || n, '@bulk' || n, 'connected' from generate_series(1, 89) as n`,
    [workspaceId],
  );
  await assert.rejects(saveConnection(postgres, workspaceId, "threads", connection("one-too-many")), (error) => {
    assert.ok(error instanceof AccountLimitError);
    assert.deepEqual(error.accountLimit, { plan: "aiforsavages", max: 100, used: 100 });
    assert.match(error.message, /All 100 of your account slots are in use/);
    return true;
  });
});

test("a membership counts only for an owner with a verified email", async () => {
  const postgres = await database();
  const { userId, workspaceId } = await workspaceFor(postgres, { verified: false });
  await makeMember(postgres, userId);
  assert.equal((await accountLimitFor(postgres, workspaceId)).plan, "pro");
});

test("without the core schema the limit falls back to Pro", async () => {
  const postgres = await database({ through: "016-tiktok-direct-post.sql" });
  const { workspaceId } = await workspaceFor(postgres);
  assert.deepEqual(await accountLimitFor(postgres, workspaceId), { plan: "pro", max: 10, used: 0 });
});
```

**Check:** `cd apps/api && node --import tsx --test test/account-limits.test.js` shows **8 passing**. Then `pnpm --filter @posterract/api test` shows every API test passing: 126 before this plan, 145 after (126 + 8 here + 11 in Phase 3).

---

## 5. Phase 2: the Hub sells AFS to Posterract buyers

All edits are in `apps/hub/src/billing.js` and `apps/hub/src/server.js`, plus one new test file. The Hub's `package.json` does not change.

### 5.1 `apps/hub/src/billing.js`: redirects may point at Posterract too

**Find:**

```js
export function siteUrl(candidate, fallbackPath) {
  const base = String(process.env.AFS_SITE_URL ?? "").replace(/\/+$/, "");
  const fallback = `${base}${fallbackPath}`;
  if (typeof candidate !== "string" || !candidate) return fallback;
  try {
    const url = new URL(candidate);
    const home = new URL(base);
    const sameSite =
      url.protocol === home.protocol &&
      (url.hostname === home.hostname ||
        url.hostname === home.hostname.replace(/^www\./, "") ||
        `www.${url.hostname}` === home.hostname);
    return sameSite ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}
```

**Replace with:**

```js
export function siteUrl(candidate, fallbackPath) {
  const base = String(process.env.AFS_SITE_URL ?? "").replace(/\/+$/, "");
  const fallback = `${base}${fallbackPath}`;
  if (typeof candidate !== "string" || !candidate) return fallback;
  try {
    const url = new URL(candidate);
    // our own two sites: AI FOR SAVAGES, and Posterract (its upgrade button)
    const ours = sameSite(url, base) || sameSite(url, posterractUrl(""));
    return ours ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function sameSite(url, base) {
  try {
    const home = new URL(base);
    return (
      url.protocol === home.protocol &&
      (url.hostname === home.hostname ||
        url.hostname === home.hostname.replace(/^www\./, "") ||
        `www.${url.hostname}` === home.hostname)
    );
  } catch {
    return false;
  }
}
```

### 5.2 `apps/hub/src/billing.js`: the webhook records guest checkouts

1. In `handleStripeEvent`, `case "checkout.session.completed"`. **Find:**

```js
      case "checkout.session.completed": {
        const accountId = await accountIdFrom(object);
        if (!accountId) return markIgnored("no_account");
```

**Replace with:**

```js
      case "checkout.session.completed": {
        // A guest checkout from Posterract's landing page: the person comes
        // from the email typed on Stripe's page (fulfillGuestCheckout).
        if (object.metadata?.flow === GUEST_FLOW) {
          const result = await fulfillGuestCheckout(client, object.id);
          if (!result.ok) return markIgnored(result.reason);
          return { status: "processed", kind: `guest_${result.status}` };
        }

        const accountId = await accountIdFrom(object);
        if (!accountId) return markIgnored("no_account");
```

2. In `case "invoice.paid"`. **Find:**

```js
        const accountId =
          (await accountIdFrom(subscription)) ?? (await accountIdFrom(object));
        if (!accountId) return markIgnored("no_account");
```

**Replace with:**

```js
        const accountId =
          (await accountIdFrom(subscription)) ?? (await accountIdFrom(object));
        if (!accountId) {
          // A guest checkout whose first payment cleared after its session's
          // own event (which found it unpaid and was ignored): record it now.
          if (subscription?.metadata?.flow === GUEST_FLOW) {
            const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
            const sessionId = sessions?.data?.[0]?.id;
            if (sessionId) {
              const result = await fulfillGuestCheckout(client, sessionId);
              if (result.ok) return { status: "processed", kind: `guest_${result.status}` };
              return markIgnored(result.reason);
            }
          }
          return markIgnored("no_account");
        }
```

### 5.3 `apps/hub/src/billing.js`: append the guest checkout code

Append this whole block to the **end** of `apps/hub/src/billing.js`, after `grantFromLegacySession`. It uses `upsertMembership`, `periodFromSubscription`, `planForPrice`, `PRICES`, `PRODUCT_ID`, `findOrCreatePerson`, `queueReview`, `normalizeEmail`, `postgres` and `withTransaction`, which the file already has.

```js
/* ------------------------------------------------------------------ */
/* Posterract: AI FOR SAVAGES for a buyer with no account yet          */
/* ------------------------------------------------------------------ */

/**
 * A checkout opened from Posterract's landing page by someone with no
 * account. Its session carries metadata.flow = GUEST_FLOW and no account_id:
 * the email typed on Stripe's page decides who the buyer is, once Stripe says
 * the money arrived (fulfillGuestCheckout).
 *
 * Its metadata must never carry `userId` or `tier` (the old website's
 * webhook, www.aiforsavages.fyi/api/webhooks/stripe, acts on exactly those
 * keys) or `workspace_id` (Posterract's webhook acts on that).
 */
export const GUEST_FLOW = "posterract_guest";

const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What each plan's Stripe price must be, so a misconfigured price is never shown. */
const PLAN_INTERVAL = { monthly: "month", yearly: "year", lifetime: null };
let plansCache;

/** A page on Posterract's site, for the addresses Stripe sends a buyer back to. */
export function posterractUrl(path) {
  const base = String(process.env.POSTERRACT_SITE_URL ?? "https://www.posterract.app").replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * The three plans' live prices from Stripe, for Posterract's landing card.
 * A plan whose price is missing, inactive, or not what its name says is left
 * out. Cached ten minutes; half a minute when something was missing.
 */
export async function publicPlans({ stripeClient = stripe } = {}) {
  if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.value;
  const plans = [];
  for (const [id, priceId] of Object.entries(PRICES)) {
    if (!priceId) continue;
    try {
      const price = await stripeClient.prices.retrieve(priceId);
      const interval = price.recurring?.interval ?? null;
      if (price.active === false || price.currency !== "usd") continue;
      if (!Number.isInteger(price.unit_amount) || interval !== PLAN_INTERVAL[id]) continue;
      plans.push({ id, amount: price.unit_amount, currency: "usd", interval });
    } catch {
      // left out; the card shows what it has
    }
  }
  plansCache = { value: plans, expiresAt: Date.now() + (plans.length === 3 ? 10 * 60_000 : 30_000) };
  return plans;
}

/**
 * Stripe Checkout for someone on Posterract's landing page with no account.
 * The buyer types their email on Stripe's page; fulfillGuestCheckout turns it
 * into a person and a membership once the money has arrived.
 */
export async function createGuestCheckout({ plan, stripeClient = stripe }) {
  const price = PRICES[plan];
  if (!price) return { ok: false, reason: "unknown_plan" };
  const mode = plan === "lifetime" ? "payment" : "subscription";
  // product, plan and flow, and nothing else (see GUEST_FLOW)
  const metadata = { product: PRODUCT_ID, plan, flow: GUEST_FLOW };

  const session = await stripeClient.checkout.sessions.create({
    mode,
    // Cards only, as in createCheckout: access is never granted on a promise.
    payment_method_types: ["card"],
    line_items: [{ price, quantity: 1 }],
    metadata,
    ...(mode === "subscription"
      ? { subscription_data: { metadata } }
      : {
          // a one-time payment makes no Customer unless asked, and refunds
          // find the person through it
          customer_creation: "always",
          payment_intent_data: { metadata },
        }),
    custom_text: {
      submit: {
        message:
          mode === "subscription"
            ? "Use the email you’ll sign in to Posterract with. No refunds, but you can cancel anytime · All sales are final."
            : "Use the email you’ll sign in to Posterract with. One payment, yours for good · All sales are final.",
      },
    },
    success_url: posterractUrl("/savages?session_id={CHECKOUT_SESSION_ID}"),
    cancel_url: posterractUrl("/#enter"),
  });
  return { ok: true, url: session.url, id: session.id };
}

/**
 * Turn a paid guest checkout into a person and a membership, in the caller's
 * transaction. Safe to call any number of times, even at the same moment, for
 * one session: the webhook calls it, and so does Posterract's welcome page in
 * case the webhook is late (Stripe recommends both).
 *
 * The person is whoever owns the email typed on Stripe's page. That needs no
 * verification step here, because a membership only ever reaches someone who
 * proves the email: Posterract counts it only once its own login has verified
 * the address (app_users.email_verified), and the AI FOR SAVAGES site only once
 * Clerk has (resolveAccount). Paying with someone else's address only gives
 * them a membership.
 */
export async function fulfillGuestCheckout(client, sessionId, { session: given, stripeClient = stripe } = {}) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, reason: "invalid_session_id" };
  }

  // 1. Everything is read back from Stripe; nothing is taken from the caller.
  let session = given;
  if (!session) {
    try {
      session = await stripeClient.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
    } catch {
      return { ok: false, reason: "session_not_found" };
    }
  }
  if (session?.id !== sessionId) return { ok: false, reason: "session_not_found" };
  if (session.metadata?.flow !== GUEST_FLOW || session.metadata?.product !== PRODUCT_ID) {
    return { ok: false, reason: "not_a_guest_checkout" };
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { ok: false, reason: "not_paid" };
  }

  // the price actually charged, never the one the metadata names
  const priceId = session.line_items?.data?.[0]?.price?.id ?? null;
  const plan = planForPrice(priceId);
  if (!plan || (plan === "lifetime") !== (session.mode === "payment")) {
    return { ok: false, reason: "not_our_price" };
  }

  const email = normalizeEmail(session.customer_details?.email ?? session.customer_email ?? "");
  if (!EMAIL.test(email)) {
    const parked = await client.query(
      `select 1 from core.review_queue
        where kind = 'guest_checkout_no_email' and details->>'session_id' = $1
        limit 1`,
      [sessionId],
    );
    if (!parked.rows[0]) {
      await queueReview(client, "guest_checkout_no_email", null, { session_id: sessionId });
    }
    return { ok: false, reason: "no_email" };
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  let subscription = null;
  if (session.mode === "subscription") {
    if (!subscriptionId) return { ok: false, reason: "no_subscription" };
    subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
    if (subscription?.items?.data?.[0]?.price?.id !== priceId) {
      return { ok: false, reason: "not_our_price" };
    }
    if (!["active", "trialing"].includes(subscription.status)) {
      // the first payment is still settling; invoice.paid finishes this later
      return { ok: false, reason: `subscription_${subscription.status}` };
    }
  }

  // 2. Once per session, however many callers arrive and in whatever order.
  const first = await client.query(
    `insert into core.billing_events (stripe_event_id, type, livemode, status)
     values ($1, 'posterract_guest_checkout', $2, 'processed')
     on conflict (stripe_event_id) do nothing
     returning stripe_event_id`,
    [`guest:${sessionId}`, session.livemode === true],
  );
  if (first.rowCount === 0) return { ok: true, status: "duplicate", email, plan };

  // 3. The person who owns that email, or a new one with a Posterract workspace.
  const { accountId, created } = await findOrCreatePerson(client, {
    email,
    displayName: session.customer_details?.name ?? null,
    imageUrl: null,
  });
  await client.query(
    `update core.billing_events set account_id = $2 where stripe_event_id = $1`,
    [`guest:${sessionId}`, accountId],
  );

  // 4. Already a member: a second payment. Change nothing and park it for
  //    Sina. The new Stripe objects stay untagged, so their later events find
  //    no person and change nothing either.
  const live = await client.query(
    `select id from core.memberships
      where account_id = $1 and product_id = $2 and status in ('active','past_due')
      limit 1`,
    [accountId, PRODUCT_ID],
  );
  if (live.rows[0]) {
    await queueReview(client, "guest_checkout_already_member", accountId, {
      session_id: sessionId,
      customer_id: customerId,
      subscription_id: subscriptionId,
      price_id: priceId,
    });
    return { ok: true, status: "already_member", accountId, email, plan, created };
  }

  // 5. Tag Stripe's objects with the person, so renewals, failed cards,
  //    cancels and refunds find them the usual way (accountIdFrom).
  if (customerId) {
    await stripeClient.customers.update(customerId, {
      metadata: { account_id: accountId, product: PRODUCT_ID },
    });
  }
  if (subscription) {
    await stripeClient.subscriptions.update(subscription.id, {
      metadata: {
        ...(subscription.metadata ?? {}),
        account_id: accountId,
        product: PRODUCT_ID,
        plan,
        flow: GUEST_FLOW,
      },
    });
  }

  // 6. The membership.
  if (subscription) {
    const { start, end } = periodFromSubscription(subscription);
    await upsertMembership(client, {
      accountId,
      plan,
      status: "active",
      source: "stripe_subscription",
      customerId,
      subscriptionId,
      priceId,
      start,
      end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    });
  } else {
    await upsertMembership(client, {
      accountId,
      plan: "lifetime",
      status: "active",
      source: "stripe_one_time",
      customerId,
      subscriptionId: null,
      priceId,
      start: new Date(),
      end: null,
    });
  }
  return { ok: true, status: "granted", accountId, email, plan, created };
}

/**
 * For Posterract's welcome page: where a guest checkout stands. A paid one is
 * recorded first if Stripe's webhook has not done it yet.
 */
export async function guestCheckoutStatus(
  sessionId,
  { stripeClient = stripe, db = postgres, transaction = withTransaction } = {},
) {
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return { state: "invalid" };
  let session;
  try {
    session = await stripeClient.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
  } catch {
    return { state: "invalid" };
  }
  if (session.metadata?.flow !== GUEST_FLOW || session.metadata?.product !== PRODUCT_ID) {
    return { state: "invalid" };
  }
  const plan = planForPrice(session.line_items?.data?.[0]?.price?.id ?? null);
  const typed = normalizeEmail(session.customer_details?.email ?? "") || null;
  if (session.status === "expired") return { state: "invalid" };
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { state: "pending", email: typed, plan };
  }

  const result = await transaction((client) =>
    fulfillGuestCheckout(client, sessionId, { session, stripeClient }),
  );
  if (!result.ok) {
    if (result.reason === "no_email") return { state: "needs_help", plan };
    if (result.reason === "no_subscription" || result.reason.startsWith("subscription_")) {
      return { state: "pending", email: typed, plan };
    }
    return { state: "invalid" };
  }

  const parked = await db.query(
    `select 1 from core.review_queue
      where kind = 'guest_checkout_already_member' and details->>'session_id' = $1
      limit 1`,
    [sessionId],
  );
  if (parked.rows[0]) return { state: "already_member", email: result.email, plan };

  const person = await db.query(
    `select id, (auth_user_id is not null) as has_login
       from app_users where lower(email) = $1 limit 1`,
    [result.email],
  );
  const accountId = person.rows[0]?.id ?? null;
  const member = accountId
    ? (await db.query(`select core.has_membership($1, $2) as ok`, [accountId, PRODUCT_ID])).rows[0]?.ok === true
    : false;
  return {
    state: member ? "active" : "pending",
    email: result.email,
    plan,
    hasPosterractLogin: person.rows[0]?.has_login === true,
  };
}
```

**Check:** `node --check apps/hub/src/billing.js` prints nothing.

### 5.4 `apps/hub/src/server.js`: three service routes for Posterract

1. Extend the import from `./billing.js`. **Find:**

```js
  handleStripeEvent,
  grantFromLegacySession,
} from "./billing.js";
```

**Replace with:**

```js
  handleStripeEvent,
  grantFromLegacySession,
  createGuestCheckout,
  guestCheckoutStatus,
  posterractUrl,
  publicPlans,
} from "./billing.js";
```

2. **Find** the three-line comment that opens the community routes:

```js
  /* ------------------------------------------------------------------ */
  /* community (Phase H)                                                 */
  /* ------------------------------------------------------------------ */
```

   **Replace with** the block below, followed by those same three lines unchanged. The new routes go right above the community routes.

```js
  /* ------------------------------------------------------------------ */
  /* Posterract: service key only. Its API calls these over the VPS's    */
  /* internal network to sell AI FOR SAVAGES on posterract.app.          */
  /* ------------------------------------------------------------------ */

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** The three plans' live prices, for Posterract's landing card. */
  app.get("/v1/service/posterract/plans", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    return reply.send({ plans: await publicPlans() });
  });

  /**
   * Stripe Checkout for one plan. With `accountId` (a signed-in Posterract
   * user, vouched for by the Posterract API) the membership lands on that
   * person; without it, the email the buyer types on Stripe's page decides
   * who they are (fulfillGuestCheckout).
   */
  app.post("/v1/service/posterract/checkout", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    const plan = String(request.body?.plan ?? "");
    if (!PRICES[plan]) return reply.code(400).send({ error: "unknown_plan" });
    const accountId = request.body?.accountId;
    if (accountId !== undefined && !UUID.test(String(accountId))) {
      return reply.code(400).send({ error: "invalid_account" });
    }
    try {
      const result = accountId
        ? await createCheckout({
            accountId,
            plan,
            successUrl: posterractUrl("/portals?savages=joined"),
            cancelUrl: posterractUrl("/portals"),
          })
        : await createGuestCheckout({ plan });
      if (!result.ok) {
        return reply.code(result.reason === "already_a_member" ? 409 : 400).send({ error: result.reason });
      }
      return reply.send({ url: result.url });
    } catch (error) {
      request.log.error({ err: error }, "posterract checkout failed");
      return reply.code(502).send({ error: "stripe_request_failed" });
    }
  });

  /** For Posterract's welcome page: records a paid guest checkout if the webhook has not, and says where it stands. */
  app.post("/v1/service/posterract/checkout-status", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    try {
      return reply.send(await guestCheckoutStatus(request.body?.sessionId));
    } catch (error) {
      request.log.error({ err: error }, "guest checkout status failed");
      return reply.code(500).send({ error: "handler_failed" });
    }
  });

```

**Check:** `node --check apps/hub/src/server.js` prints nothing.

### 5.5 `deploy/aiforsavages/compose.yaml`: Posterract's address

**Find:** `      AFS_SITE_URL: ${AFS_SITE_URL:-https://aiforsavages.fyi}`

**Replace with:**

```yaml
      AFS_SITE_URL: ${AFS_SITE_URL:-https://aiforsavages.fyi}
      # Where Stripe sends a buyer who started on Posterract (billing.js posterractUrl).
      POSTERRACT_SITE_URL: ${POSTERRACT_SITE_URL:-https://www.posterract.app}
```

### 5.6 New test `apps/hub/test/guest-checkout.test.js`

The Hub isn't in the pnpm workspace. Locally its `node_modules` holds symlinks into the API's (`pg -> ../../api/node_modules/pg`, `stripe -> ../../api/node_modules/stripe`). Give it PGlite the same way. This is local only: never commit `node_modules` and never add PGlite to the Hub's `package.json`.

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/hub" && ln -sfn ../../api/node_modules/@electric-sql node_modules/@electric-sql && ls node_modules/@electric-sql/pglite/package.json
```

The new file:

```js
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Buying AI FOR SAVAGES from Posterract's landing page with no account: the
 * email typed on Stripe's page becomes a person, a Posterract workspace and a
 * membership, exactly once, whoever asks first.
 *
 * In-memory Postgres (PGlite) with every migration and a fake Stripe: no
 * network, no real database, no money. Run it alone:
 *   cd apps/hub && node --test test/guest-checkout.test.js
 */

// billing.js reads these as it loads. db.js insists on a URL, but nothing here
// touches its pool: every function under test is handed the PGlite client.
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.AFS_STRIPE_PRICE_MONTHLY = "price_afs_monthly";
process.env.AFS_STRIPE_PRICE_YEARLY = "price_afs_yearly";
process.env.AFS_STRIPE_PRICE_LIFETIME = "price_afs_lifetime";
process.env.AFS_SITE_URL = "https://www.aiforsavages.fyi";
process.env.POSTERRACT_SITE_URL = "https://www.posterract.app";
delete process.env.STRIPE_SECRET_KEY;

const { GUEST_FLOW, createGuestCheckout, fulfillGuestCheckout, guestCheckoutStatus, publicPlans, siteUrl } =
  await import("../src/billing.js");

const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, "../../../deploy/posterract/postgres/init");
const NOW = Math.floor(Date.now() / 1000);

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const files = (await readdir(migrations)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) await db.exec(await readFile(resolve(migrations, name), "utf8"));
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  return { query };
}

function fakeStripe({ sessions = {}, subscriptions = {}, prices = {} } = {}) {
  const calls = { created: [], customers: [], subscriptions: [] };
  return {
    calls,
    checkout: {
      sessions: {
        create: async (params) => {
          calls.created.push(params);
          return { id: "cs_test_created0001", url: "https://checkout.stripe.com/c/pay/cs_test_created0001" };
        },
        retrieve: async (id) => {
          if (!sessions[id]) throw new Error("No such checkout.session");
          return sessions[id];
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => subscriptions[id],
      update: async (id, params) => {
        calls.subscriptions.push({ id, ...params });
        return { ...subscriptions[id], ...params };
      },
    },
    customers: {
      update: async (id, params) => {
        calls.customers.push({ id, ...params });
        return { id, ...params };
      },
    },
    prices: {
      retrieve: async (id) => {
        if (!prices[id]) throw new Error("No such price");
        return prices[id];
      },
    },
  };
}

let sequence = 0;
/** A checkout from the landing page, as Stripe returns it with line_items expanded. */
function guestSession({ plan = "monthly", email = "Buyer@Example.test", paid = true } = {}) {
  sequence += 1;
  const id = `cs_test_guest${String(sequence).padStart(6, "0")}`;
  const mode = plan === "lifetime" ? "payment" : "subscription";
  return {
    id,
    object: "checkout.session",
    livemode: false,
    mode,
    status: paid ? "complete" : "open",
    payment_status: paid ? "paid" : "unpaid",
    metadata: { product: "aiforsavages", plan, flow: GUEST_FLOW },
    customer: `cus_${id}`,
    subscription: mode === "subscription" ? `sub_${id}` : null,
    customer_details: { email, name: "Buyer Test" },
    line_items: { data: [{ price: { id: `price_afs_${plan}` } }] },
  };
}

function subscriptionFor(session, status = "active") {
  return {
    id: session.subscription,
    object: "subscription",
    status,
    cancel_at_period_end: false,
    customer: session.customer,
    metadata: { ...session.metadata },
    items: {
      data: [{
        price: { id: session.line_items.data[0].price.id },
        current_period_start: NOW,
        current_period_end: NOW + 30 * 86_400,
      }],
    },
  };
}

/** Stripe holding this one session, and its subscription. */
function stripeWith(session, subscriptionStatus = "active") {
  return fakeStripe({
    sessions: { [session.id]: session },
    subscriptions: session.subscription
      ? { [session.subscription]: subscriptionFor(session, subscriptionStatus) }
      : {},
  });
}

const personByEmail = async (db, email) =>
  (await db.query("select id, email, email_verified, auth_user_id from app_users where lower(email) = $1", [email])).rows[0];
const isMember = async (db, accountId) =>
  (await db.query("select core.has_membership($1, 'aiforsavages') as ok", [accountId])).rows[0].ok;
const count = async (db, sql, params = []) => (await db.query(sql, params)).rows[0].n;

test("a paid checkout makes the person, their Posterract workspace and a live membership", async () => {
  const db = await database();
  const session = guestSession({ email: "  New.Buyer@Example.TEST " });
  const stripe = stripeWith(session);

  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.ok, true);
  assert.equal(result.status, "granted");
  assert.equal(result.created, true);

  const person = await personByEmail(db, "new.buyer@example.test");
  assert.ok(person, "stored trimmed and lower-cased");
  assert.notEqual(person.email_verified, true, "only Posterract's own login may verify the email");
  assert.equal(person.auth_user_id, null, "no Posterract login until they make one");

  const workspace = (await db.query("select id from workspaces where owner_id = $1", [person.id])).rows[0];
  assert.ok(workspace, "a Posterract workspace, exactly as sign-up makes one");
  assert.equal(
    (await db.query("select role from workspace_memberships where workspace_id = $1 and user_id = $2", [workspace.id, person.id])).rows[0].role,
    "owner",
  );
  assert.equal(await count(db, "select count(*)::int as n from social_accounts where workspace_id = $1 and status = 'disconnected'", [workspace.id]), 6);

  const membership = (await db.query("select * from core.memberships where account_id = $1", [person.id])).rows[0];
  assert.equal(membership.plan, "monthly");
  assert.equal(membership.status, "active");
  assert.equal(membership.source, "stripe_subscription");
  assert.equal(membership.stripe_subscription_id, session.subscription);
  assert.equal(membership.stripe_customer_id, session.customer);
  assert.ok(membership.current_period_end);
  assert.equal(await isMember(db, person.id), true);

  assert.deepEqual(stripe.calls.customers, [
    { id: session.customer, metadata: { account_id: person.id, product: "aiforsavages" } },
  ]);
  assert.equal(stripe.calls.subscriptions[0].metadata.account_id, person.id);
});

test("asked twice (the webhook, then the welcome page) it is recorded once", async () => {
  const db = await database();
  const session = guestSession();
  const stripe = stripeWith(session);
  assert.equal((await fulfillGuestCheckout(db, session.id, { stripeClient: stripe })).status, "granted");
  const again = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(again.ok, true);
  assert.equal(again.status, "duplicate");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 1);
  assert.equal(stripe.calls.customers.length, 1);
});

test("an unpaid checkout records nothing yet, and is recorded once paid", async () => {
  const db = await database();
  const session = guestSession({ paid: false });
  const stripe = stripeWith(session);
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "not_paid" });
  assert.equal(await count(db, "select count(*)::int as n from core.billing_events where stripe_event_id = $1", [`guest:${session.id}`]), 0);
  session.status = "complete";
  session.payment_status = "paid";
  assert.equal((await fulfillGuestCheckout(db, session.id, { stripeClient: stripe })).status, "granted");
});

test("a subscription whose first payment is still settling waits for it", async () => {
  const db = await database();
  const session = guestSession();
  const stripe = stripeWith(session, "incomplete");
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "subscription_incomplete" });
  assert.equal(await count(db, "select count(*)::int as n from core.billing_events"), 0);
});

test("lifetime: a one-time payment grants a membership that never ends", async () => {
  const db = await database();
  const session = guestSession({ plan: "lifetime" });
  const stripe = stripeWith(session);
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.status, "granted");
  const membership = (await db.query("select * from core.memberships where account_id = $1", [result.accountId])).rows[0];
  assert.equal(membership.plan, "lifetime");
  assert.equal(membership.source, "stripe_one_time");
  assert.equal(membership.current_period_end, null);
  assert.equal(membership.stripe_subscription_id, null);
  assert.equal(stripe.calls.customers.length, 1);
  assert.equal(stripe.calls.subscriptions.length, 0);
});

test("someone who already uses Posterract gets the membership on their own account", async () => {
  const db = await database();
  const existing = (await db.query(
    "insert into app_users (email, display_name, email_verified) values ('existing@example.test', 'Existing', true) returning id",
  )).rows[0];
  await db.query("insert into workspaces (owner_id, name) values ($1, 'Mine')", [existing.id]);
  const session = guestSession({ email: "Existing@Example.test" });
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripeWith(session) });
  assert.equal(result.accountId, existing.id);
  assert.equal(result.created, false);
  assert.equal(await count(db, "select count(*)::int as n from workspaces where owner_id = $1", [existing.id]), 1);
  assert.equal(await isMember(db, existing.id), true);
});

test("a member who pays again changes nothing and is parked for Sina", async () => {
  const db = await database();
  const member = (await db.query("insert into app_users (email) values ('member@example.test') returning id")).rows[0];
  await db.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, current_period_end)
     values ($1, 'aiforsavages', 'monthly', 'active', 'manual', now() + interval '30 days')`,
    [member.id],
  );
  const session = guestSession({ email: "member@example.test" });
  const stripe = stripeWith(session);
  const result = await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(result.status, "already_member");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships where account_id = $1", [member.id]), 1);
  assert.equal(await count(db, "select count(*)::int as n from core.review_queue where kind = 'guest_checkout_already_member' and details->>'session_id' = $1", [session.id]), 1);
  assert.equal(stripe.calls.customers.length, 0, "the second payment's customer stays untagged");
  assert.equal(stripe.calls.subscriptions.length, 0);

  const status = await guestCheckoutStatus(session.id, { stripeClient: stripe, db, transaction: (run) => run(db) });
  assert.equal(status.state, "already_member");
});

test("no email from Stripe: nothing is granted and one review is parked", async () => {
  const db = await database();
  const session = guestSession({ email: null });
  const stripe = stripeWith(session);
  assert.deepEqual(await fulfillGuestCheckout(db, session.id, { stripeClient: stripe }), { ok: false, reason: "no_email" });
  await fulfillGuestCheckout(db, session.id, { stripeClient: stripe });
  assert.equal(await count(db, "select count(*)::int as n from core.review_queue where kind = 'guest_checkout_no_email'"), 1);
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 0);
});

test("anything that is not a guest checkout, or not our price, is refused", async () => {
  const db = await database();
  const notGuest = guestSession();
  notGuest.metadata = { product: "aiforsavages", plan: "monthly" };
  assert.equal((await fulfillGuestCheckout(db, notGuest.id, { stripeClient: stripeWith(notGuest) })).reason, "not_a_guest_checkout");

  const foreign = guestSession();
  foreign.line_items.data[0].price.id = "price_1U7UwZCoOesYmdbAFycPOK9b"; // Posterract Pro
  assert.equal((await fulfillGuestCheckout(db, foreign.id, { stripeClient: stripeWith(foreign) })).reason, "not_our_price");

  const mismatched = guestSession();
  mismatched.line_items.data[0].price.id = "price_afs_lifetime"; // a lifetime price in a subscription
  assert.equal((await fulfillGuestCheckout(db, mismatched.id, { stripeClient: stripeWith(mismatched) })).reason, "not_our_price");

  assert.equal((await fulfillGuestCheckout(db, "garbage")).reason, "invalid_session_id");
  assert.equal(await count(db, "select count(*)::int as n from core.memberships"), 0);
});

test("the welcome page's status: pending, then active with the email", async () => {
  const db = await database();
  const session = guestSession({ paid: false, email: "Pay.Later@Example.test" });
  const stripe = stripeWith(session);
  const ask = () => guestCheckoutStatus(session.id, { stripeClient: stripe, db, transaction: (run) => run(db) });
  assert.deepEqual(await ask(), { state: "pending", email: "pay.later@example.test", plan: "monthly" });
  session.status = "complete";
  session.payment_status = "paid";
  assert.deepEqual(await ask(), { state: "active", email: "pay.later@example.test", plan: "monthly", hasPosterractLogin: false });
  assert.deepEqual(await guestCheckoutStatus("nope", { stripeClient: stripe, db }), { state: "invalid" });
});

test("a guest checkout carries only product, plan and flow, and comes back to Posterract", async () => {
  const stripe = fakeStripe();
  assert.deepEqual(await createGuestCheckout({ plan: "weekly", stripeClient: stripe }), { ok: false, reason: "unknown_plan" });

  const monthly = await createGuestCheckout({ plan: "monthly", stripeClient: stripe });
  assert.equal(monthly.ok, true);
  const params = stripe.calls.created[0];
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.payment_method_types, ["card"]);
  assert.deepEqual(params.metadata, { product: "aiforsavages", plan: "monthly", flow: GUEST_FLOW });
  assert.deepEqual(params.subscription_data.metadata, params.metadata);
  for (const key of ["userId", "tier", "workspace_id", "account_id"]) {
    assert.equal(key in params.metadata, false, `${key} would make another webhook act on it`);
  }
  assert.equal(params.client_reference_id, undefined);
  assert.equal(params.customer, undefined);
  assert.equal(params.success_url, "https://www.posterract.app/savages?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, "https://www.posterract.app/#enter");

  await createGuestCheckout({ plan: "lifetime", stripeClient: stripe });
  const lifetime = stripe.calls.created[1];
  assert.equal(lifetime.mode, "payment");
  assert.equal(lifetime.customer_creation, "always");
  assert.deepEqual(lifetime.payment_intent_data.metadata, { product: "aiforsavages", plan: "lifetime", flow: GUEST_FLOW });
});

test("plans: only prices that are what their name says", async () => {
  const stripe = fakeStripe({
    prices: {
      price_afs_monthly: { active: true, currency: "usd", unit_amount: 5999, recurring: { interval: "month" } },
      price_afs_yearly: { active: true, currency: "usd", unit_amount: 59999, recurring: { interval: "month" } }, // wrong
      price_afs_lifetime: { active: true, currency: "usd", unit_amount: 200000, recurring: null },
    },
  });
  assert.deepEqual(await publicPlans({ stripeClient: stripe }), [
    { id: "monthly", amount: 5999, currency: "usd", interval: "month" },
    { id: "lifetime", amount: 200000, currency: "usd", interval: null },
  ]);
});

test("redirects may point at either of our two sites, nowhere else", () => {
  assert.equal(siteUrl("https://www.posterract.app/portals?savages=joined", "/x"), "https://www.posterract.app/portals?savages=joined");
  assert.equal(siteUrl("https://posterract.app/portals", "/x"), "https://posterract.app/portals");
  assert.equal(siteUrl("https://www.aiforsavages.fyi/?join=monthly", "/x"), "https://www.aiforsavages.fyi/?join=monthly");
  assert.equal(siteUrl("https://evil.example/", "/?success=true"), "https://www.aiforsavages.fyi/?success=true");
});
```

**Check:** `cd apps/hub && node --test test/guest-checkout.test.js` shows **13 passing**. Do not run the Hub's other test files (rule 0.1.8).

---

## 6. Phase 3: the Posterract API's pass-through routes

### 6.1 New file `apps/api/src/savages.js`

```js
/**
 * AI FOR SAVAGES, sold from Posterract: the landing page's second payment
 * option, and the upgrade a Pro workspace is offered when all ten of its
 * account slots are in use.
 *
 * The Hub (apps/hub, its own container on the VPS) owns everything about the
 * membership: the prices, the Stripe checkout, the people list and who is a
 * member. These routes only pass requests to it over the VPS's internal
 * network with the Hub's service key. Nothing here creates a Stripe object or
 * writes a core.* table.
 */

const PLAN_IDS = ["monthly", "yearly", "lifetime"];
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const PLAN_BODY = {
  type: "object",
  required: ["plan"],
  additionalProperties: false,
  properties: { plan: { type: "string", enum: PLAN_IDS } },
};

/** One call to the Hub. Never throws: a failure comes back as { ok: false }. */
export function createHubClient({ environment = process.env, fetchImpl = fetch } = {}) {
  const baseUrl = String(environment.HUB_INTERNAL_URL || "http://hub:3003").replace(/\/+$/, "");
  const key = environment.HUB_SERVICE_KEY || "";
  return async function hub(path, { method = "GET", body } = {}) {
    if (!key) return { ok: false, status: 503, error: "hub_not_configured" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return response.ok
        ? { ok: true, status: response.status, data }
        : { ok: false, status: response.status, error: data?.error ?? `hub_http_${response.status}` };
    } catch (error) {
      return { ok: false, status: 0, error: error?.name === "AbortError" ? "hub_timeout" : "hub_unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A per-visitor limit for the public routes, in Redis like /v1/contact's. */
async function overLimit(redis, key, max) {
  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `posterract:savages-rate:${key}:${minute}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 120);
  return count > max;
}

export function registerSavagesRoutes(app, { hub, redis, clientAddress, requireInteractiveSession }) {
  let plansCache;

  // The three plans' live Stripe prices, for the landing's card and the
  // upgrade buttons. Public; cached ten minutes.
  app.get("/v1/savages/plans", async (_request, reply) => {
    if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.value;
    const result = await hub("/v1/service/posterract/plans");
    if (!result.ok || !Array.isArray(result.data?.plans) || result.data.plans.length === 0) {
      return reply.code(503).send({ error: "savages_unavailable" });
    }
    plansCache = { value: { plans: result.data.plans }, expiresAt: Date.now() + 10 * 60_000 };
    return plansCache.value;
  });

  // The landing page's button: Stripe Checkout for someone with no account.
  app.post("/v1/savages/checkout", { schema: { body: PLAN_BODY } }, async (request, reply) => {
    if (await overLimit(redis, `checkout:${clientAddress(request)}`, 10)) {
      reply.header("retry-after", 60);
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
    const result = await hub("/v1/service/posterract/checkout", {
      method: "POST",
      body: { plan: request.body.plan },
    });
    if (result.ok && typeof result.data?.url === "string") return { url: result.data.url };
    request.log.error({ status: result.status, error: result.error }, "AI FOR SAVAGES checkout failed");
    return reply.code(503).send({ error: "checkout_unavailable" });
  });

  // The upgrade buttons in the app: the membership lands on the signed-in
  // owner (the account limit follows the owner's membership).
  app.post(
    "/v1/savages/checkout/member",
    { preHandler: requireInteractiveSession, schema: { body: PLAN_BODY } },
    async (request, reply) => {
      if (request.authContext?.role !== "owner") {
        return reply.code(403).send({ error: "owner_only" });
      }
      const result = await hub("/v1/service/posterract/checkout", {
        method: "POST",
        body: { plan: request.body.plan, accountId: request.authContext.userId },
      });
      if (result.ok && typeof result.data?.url === "string") return { url: result.data.url };
      if (result.status === 409) return reply.code(409).send({ error: "already_a_member" });
      request.log.error({ status: result.status, error: result.error }, "AI FOR SAVAGES member checkout failed");
      return reply.code(503).send({ error: "checkout_unavailable" });
    },
  );

  // The welcome page after Stripe: is the payment in, and for which email?
  // Asking also records the purchase if Stripe's webhook has not yet.
  app.get("/v1/savages/checkout/:sessionId", async (request, reply) => {
    const { sessionId } = request.params;
    if (!SESSION_ID.test(sessionId)) return reply.code(400).send({ error: "invalid_session_id" });
    if (await overLimit(redis, `status:${clientAddress(request)}`, 120)) {
      reply.header("retry-after", 60);
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
    reply.header("cache-control", "no-store");
    const result = await hub("/v1/service/posterract/checkout-status", {
      method: "POST",
      body: { sessionId },
    });
    if (!result.ok) return reply.code(503).send({ error: "status_unavailable" });
    const { state, email, plan, hasPosterractLogin } = result.data ?? {};
    return { state, email, plan, hasPosterractLogin };
  });
}
```

### 6.2 `apps/api/src/server.js`: register them

1. Add with the other imports:

```js
import { createHubClient, registerSavagesRoutes } from "./savages.js";
```

2. Directly after the whole `app.post("/v1/contact", …);` route, before `registerDesktopAuthRoutes(app, {`, add:

```js
// AI FOR SAVAGES, sold from Posterract through the Hub (apps/api/src/savages.js).
registerSavagesRoutes(app, {
  hub: createHubClient({ environment: env }),
  redis,
  clientAddress: contactClientAddress,
  requireInteractiveSession,
});
```

**Check:** `node --check apps/api/src/savages.js && node --check apps/api/src/server.js` prints nothing.

### 6.3 `deploy/posterract/compose.yaml`: the API reaches the Hub

In the `api:` service's `environment:`, **Find:**

```yaml
      STRIPE_YEARLY_PRICE_ID: ${STRIPE_YEARLY_PRICE_ID:-}
```

**Replace with:**

```yaml
      STRIPE_YEARLY_PRICE_ID: ${STRIPE_YEARLY_PRICE_ID:-}
      # AI FOR SAVAGES sold from Posterract (apps/api/src/savages.js): the Hub,
      # reached over posterract-network, and the service key it expects.
      HUB_INTERNAL_URL: ${HUB_INTERNAL_URL:-http://hub:3003}
      HUB_SERVICE_KEY: ${HUB_SERVICE_KEY:-}
```

### 6.4 New test `apps/api/test/savages.test.js`

```js
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createHubClient, registerSavagesRoutes } from "../src/savages.js";

const OWNER = "00000000-0000-4000-8000-000000000001";

function fakeRedis() {
  const counts = new Map();
  return {
    incr: async (key) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    expire: async () => 1,
  };
}

function appWith(answer, { role = "owner" } = {}) {
  const app = Fastify();
  const calls = [];
  registerSavagesRoutes(app, {
    hub: async (path, init = {}) => {
      calls.push({ path, ...init });
      return answer(path, init);
    },
    redis: fakeRedis(),
    clientAddress: () => "203.0.113.7",
    requireInteractiveSession: async (request) => {
      request.authContext = { kind: "session", userId: OWNER, role };
    },
  });
  return { app, calls };
}

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_live_abc";
const ok = (data) => ({ ok: true, status: 200, data });

test("the landing's checkout asks the Hub for a guest checkout and returns Stripe's page", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { url: STRIPE_URL });
  assert.deepEqual(calls, [{ path: "/v1/service/posterract/checkout", method: "POST", body: { plan: "monthly" } }]);
});

test("an unknown plan never reaches the Hub", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "weekly" } });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("the in-app upgrade sends the signed-in owner", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "yearly" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0].body, { plan: "yearly", accountId: OWNER });
});

test("only the workspace owner can upgrade", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }), { role: "editor" });
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 403);
  assert.equal(calls.length, 0);
});

test("already a member answers 409", async () => {
  const { app } = appWith(() => ({ ok: false, status: 409, error: "already_a_member" }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 409);
});

test("the Hub being down is a 503, never a crash", async () => {
  const { app } = appWith(() => ({ ok: false, status: 0, error: "hub_unreachable" }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "checkout_unavailable" });
});

test("plans are cached", async () => {
  const plans = [{ id: "monthly", amount: 5999, currency: "usd", interval: "month" }];
  const { app, calls } = appWith(() => ok({ plans }));
  for (let index = 0; index < 2; index += 1) {
    const response = await app.inject({ method: "GET", url: "/v1/savages/plans" });
    assert.deepEqual(response.json(), { plans });
  }
  assert.equal(calls.length, 1);
});

test("status: a malformed session id is refused before the Hub", async () => {
  const { app, calls } = appWith(() => ok({ state: "active" }));
  const response = await app.inject({ method: "GET", url: "/v1/savages/checkout/not-a-session" });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("status passes only its four fields through", async () => {
  const { app } = appWith(() => ok({ state: "active", email: "b@example.test", plan: "monthly", hasPosterractLogin: false, accountId: "secret-ish" }));
  const response = await app.inject({ method: "GET", url: "/v1/savages/checkout/cs_live_a1b2c3d4e5f6" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { state: "active", email: "b@example.test", plan: "monthly", hasPosterractLogin: false });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("the landing's checkout is rate limited per visitor", async () => {
  const { app } = appWith(() => ok({ url: STRIPE_URL }));
  let last;
  for (let index = 0; index < 11; index += 1) {
    last = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  }
  assert.equal(last.statusCode, 429);
});

test("the Hub client sends the service key and never throws", async () => {
  let seen;
  const hub = createHubClient({
    environment: { HUB_SERVICE_KEY: "test-key", HUB_INTERNAL_URL: "http://hub:3003/" },
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ plans: [] }), { status: 200 });
    },
  });
  assert.deepEqual(await hub("/v1/service/posterract/plans"), { ok: true, status: 200, data: { plans: [] } });
  assert.equal(seen.url, "http://hub:3003/v1/service/posterract/plans");
  assert.equal(seen.init.headers.authorization, "Bearer test-key");

  const keyless = createHubClient({ environment: {} });
  assert.deepEqual(await keyless("/x"), { ok: false, status: 503, error: "hub_not_configured" });

  const broken = createHubClient({ environment: { HUB_SERVICE_KEY: "k" }, fetchImpl: async () => { throw new Error("down"); } });
  assert.deepEqual(await broken("/x"), { ok: false, status: 0, error: "hub_unreachable" });
});
```

**Check:** `cd apps/api && node --import tsx --test test/savages.test.js` shows **11 passing**.

---

## 7. Phase 4: account limits in the web app, and the in-app upgrade

### 7.1 `apps/web/src/engine/postgres.ts`

1. The type imports. **Find:**

```ts
  CardImagesDTO,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
} from "@posterract/contract";
```

   **Replace with:**

```ts
  CardImagesDTO,
  PortalDTO,
  ProjectionDTO,
  TransmissionDTO,
  AccountLimitDTO,
  SavagesPlanDTO,
  SavagesPlanId,
} from "@posterract/contract";
```

2. The bootstrap type. **Find:**

```ts
  businesses: BusinessDTO[];
  points: PointsSummaryDTO;
};
```

   **Replace with:**

```ts
  businesses: BusinessDTO[];
  points: PointsSummaryDTO;
  /** How many accounts the workspace may connect (10 on Pro, 100 for an AI FOR SAVAGES member). */
  accountLimit?: AccountLimitDTO;
};
```

3. What a visit remembers, in `remember()`. **Find:**

```ts
    businesses: state.businesses,
    points: state.points,
  };
```

   **Replace with:**

```ts
    businesses: state.businesses,
    points: state.points,
    accountLimit: state.accountLimit,
  };
```

4. The OAuth result types. This text appears **twice**, in `complete` and in `selectFacebookPage`; change both. **Find:**

```ts
        error?: string;
        returnTo?: "desktop" | "web";
```

   **Replace with** (both places):

```ts
        error?: string;
        code?: string;
        returnTo?: "desktop" | "web";
```

5. The new hooks. **Find:**

```ts
export const usePortals = () => usePostgresStore((state) => state.portals);
```

   **Replace with:**

```ts
export const usePortals = () => usePostgresStore((state) => state.portals);
export const useAccountLimit = () => usePostgresStore((state) => state.accountLimit);
export const useRefresh = () => usePostgresStore((state) => state.refresh);
/** AI FOR SAVAGES' three plans, live from Stripe through the Hub. */
export const fetchSavagesPlans = () => request<{ plans: SavagesPlanDTO[] }>("/v1/savages/plans");
/** Stripe Checkout for AI FOR SAVAGES, for the signed-in owner. */
export const startSavagesCheckout = (plan: SavagesPlanId) =>
  request<{ url: string }>("/v1/savages/checkout/member", { method: "POST", body: JSON.stringify({ plan }) });
```

### 7.2 `apps/web/src/engine/useEngine.ts`

1. **Find:**

```ts
import type { PlatformId } from "@posterract/contract";
```

   **Replace with:**

```ts
import type { AccountLimitDTO, PlatformId, SavagesPlanDTO, SavagesPlanId } from "@posterract/contract";
```

2. **Find:**

```ts
export const useBusinessActions = impl.useBusinessActions;
```

   **Replace with** that same line, followed by:

```ts
/** The workspace's account limit. Only the Postgres engine has one; the demo and Convex engines don't. */
export const useAccountLimit: () => AccountLimitDTO | undefined = POSTGRES
  ? postgresEngine.useAccountLimit
  : () => undefined;
export const useEngineRefresh: () => () => Promise<void> = POSTGRES
  ? postgresEngine.useRefresh
  : () => async () => undefined;
export const fetchSavagesPlans: () => Promise<{ plans: SavagesPlanDTO[] }> = POSTGRES
  ? postgresEngine.fetchSavagesPlans
  : async () => ({ plans: [] });
export const startSavagesCheckout: (plan: SavagesPlanId) => Promise<{ url: string }> = POSTGRES
  ? postgresEngine.startSavagesCheckout
  : async () => {
      throw new Error("AI FOR SAVAGES checkout needs the production API");
    };
```

### 7.3 New file `apps/web/src/lib/savages.ts`

The landing card, the in-app notice and the welcome page all use it.

```ts
import { useEffect, useState } from "react";
import type { SavagesPlanDTO, SavagesPlanId } from "@posterract/contract";
import { posterractApiUrl } from "@/lib/authClient";

/** Each plan's price in cents, as Stripe charges it. */
export type SavagesPlans = Partial<Record<SavagesPlanId, number>>;

/** The public API's base: same origin in production, api.posterract.app elsewhere. */
export const savagesApiBase = () => posterractApiUrl || "https://api.posterract.app";

/** "$59.99", "$599.99", "$2,000", "$119.89". */
export function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function toPlans(list: SavagesPlanDTO[]): SavagesPlans {
  return Object.fromEntries(list.map((plan) => [plan.id, plan.amount]));
}

/** The live prices for the landing card. `initial` skips the request (the local preview passes it). */
export function useSavagesPlans(initial?: SavagesPlans) {
  const [plans, setPlans] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    setFailed(false);
    void fetch(`${savagesApiBase()}/v1/savages/plans`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const data = (await response.json()) as { plans?: SavagesPlanDTO[] };
        if (!data.plans?.length) throw new Error("unavailable");
        setPlans(toPlans(data.plans));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [initial, attempt]);

  return { plans, failed, retry: () => setAttempt((value) => value + 1) };
}

/** Stripe Checkout for someone with no Posterract login yet. Resolves to Stripe's URL. */
export async function startGuestCheckout(plan: SavagesPlanId): Promise<string> {
  const response = await fetch(`${savagesApiBase()}/v1/savages/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? "checkout_unavailable");
  return data.url;
}
```

### 7.4 `apps/web/src/routes/_app/portals.tsx`

1. **Imports.** **Find:**

```tsx
import { createFileRoute } from "@tanstack/react-router";
```

   **Replace with:**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
```

   Then **Find:**

```tsx
  type BusinessDTO,
  type PlatformId,
  type PortalDTO,
} from "@posterract/contract";
import {
  useBusinessActions,
  useBusinesses,
  useEngineActions,
  useOAuth,
  usePortals,
} from "@/engine/useEngine";
```

   **Replace with:**

```tsx
  type AccountLimitDTO,
  type BusinessDTO,
  type PlatformId,
  type PortalDTO,
  type SavagesPlanId,
} from "@posterract/contract";
import {
  fetchSavagesPlans,
  startSavagesCheckout,
  useAccountLimit,
  useBusinessActions,
  useBusinesses,
  useEngineActions,
  useEngineRefresh,
  useOAuth,
  usePortals,
} from "@/engine/useEngine";
import { money, toPlans, type SavagesPlans } from "@/lib/savages";
```

2. **The old per-platform cap goes.** **Find:**

```tsx
const MAX_ACCOUNTS_PER_PLATFORM = 10;
const PLATFORM_ORDER = PLATFORM_IDS as readonly PlatformId[];
```

   **Replace with:**

```tsx
const PLATFORM_ORDER = PLATFORM_IDS as readonly PlatformId[];
```

3. **The notice component.** **Find:**

```tsx
function Portals() {
```

   **Replace with** the component below, followed by that same line `function Portals() {`:

```tsx
const UPGRADE_PLANS: Array<{ id: SavagesPlanId; name: string; suffix: string }> = [
  { id: "monthly", name: "Monthly", suffix: "/mo" },
  { id: "yearly", name: "Yearly", suffix: "/yr" },
  { id: "lifetime", name: "Lifetime", suffix: " once" },
];

/** At the limit. Pro is offered AI FOR SAVAGES (100 accounts): one button per plan, straight to Stripe. */
function AccountLimitNotice({ limit }: { limit: AccountLimitDTO }) {
  const [plans, setPlans] = useState<SavagesPlans>();
  const [busy, setBusy] = useState<SavagesPlanId>();
  const member = limit.plan === "aiforsavages";

  useEffect(() => {
    if (member) return;
    let live = true;
    void fetchSavagesPlans()
      .then((result) => {
        if (live) setPlans(toPlans(result.plans));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [member]);

  if (member) {
    return (
      <p className="mb-3 rounded-[13px] border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[11px] text-starlight-dim">
        All {limit.max} of your account slots are in use. Disconnect an account to add another.
      </p>
    );
  }

  const join = async (plan: SavagesPlanId) => {
    if (busy) return;
    setBusy(plan);
    try {
      const { url } = await startSavagesCheckout(plan);
      await openExternalUrl(url);
    } catch (error) {
      pushSignal({
        tone: "danger",
        title: "Couldn’t open checkout",
        detail: error instanceof Error ? error.message.replaceAll("_", " ") : undefined,
      });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#64d2ff]/25 bg-[#64d2ff]/[0.05] px-4 py-3">
      <p className="min-w-0 flex-1 text-[12px] text-starlight">
        All {limit.max} of your Pro account slots are in use.{" "}
        <span className="text-starlight-faint">Disconnect one to add another, or join AI FOR SAVAGES to connect up to 100.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {UPGRADE_PLANS.map((item) => {
          const amount = plans?.[item.id];
          return (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === "monthly" ? "primary" : "secondary"}
              disabled={Boolean(busy)}
              onClick={() => void join(item.id)}
            >
              {busy === item.id ? "Opening…" : amount ? `${money(amount)}${item.suffix}` : item.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

```

4. **The limit inside the page.** **Find:**

```tsx
  const oauth = useOAuth();
```

   **Replace with:**

```tsx
  const oauth = useOAuth();
  const navigate = useNavigate();
  const accountLimit = useAccountLimit();
  const refreshEngine = useEngineRefresh();
  const atLimit = accountLimit ? accountLimit.used >= accountLimit.max : false;

  // Back from Stripe after joining AI FOR SAVAGES. The membership is usually
  // in before Stripe redirects (it waits for the webhook); read the new limit
  // now and twice more in case it was a moment late.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("savages") !== "joined") return;
    void navigate({ to: "/portals", replace: true });
    pushSignal({ tone: "success", title: "Welcome to AI FOR SAVAGES", detail: "Your workspace can now connect up to 100 accounts." });
    void refreshEngine();
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refreshEngine();
      if (tries >= 2) window.clearInterval(timer);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [navigate, refreshEngine]);
```

5. **The heading.** **Find:**

```tsx
<h2 className="mt-1 font-display text-[17px] font-semibold text-starlight">Up to 10 accounts per network</h2>
```

   **Replace with:**

```tsx
<h2 className="mt-1 font-display text-[17px] font-semibold text-starlight">{accountLimit ? `${accountLimit.used} of ${accountLimit.max} accounts` : "Your accounts"}</h2>
```

6. **The notice, above the platform grid.** **Find:**

```tsx
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
```

   **Replace with:**

```tsx
        {atLimit && accountLimit && <AccountLimitNotice limit={accountLimit} />}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
```

7. **Connect and Add account turn off at the workspace limit.** **Find:**

```tsx
            const limitReached = connected.length >= MAX_ACCOUNTS_PER_PLATFORM;
```

   **Replace with:**

```tsx
            const limitReached = atLimit;
```

   Reconnect buttons don't use `limitReached`, so they stay enabled.

8. **Each platform's counter loses its old per-platform "/10".** Each platform card's corner shows `{connected.length}/{MAX_ACCOUNTS_PER_PLATFORM}`, for example "3/10". That cap no longer exists. **Find:**

```tsx
{connected.length}/{MAX_ACCOUNTS_PER_PLATFORM}</span>
```

   **Replace with:**

```tsx
{connected.length}</span>
```

**Check:** `grep -n MAX_ACCOUNTS_PER_PLATFORM apps/web/src/routes/_app/portals.tsx` prints nothing.

### 7.5 `apps/web/src/routes/oauth.callback.$provider.tsx`: name the limit

1. **Find:**

```tsx
        error?: string;
        returnTo?: OAuthReturnTarget;
```

   **Replace with:**

```tsx
        error?: string;
        code?: string;
        returnTo?: OAuthReturnTarget;
```

2. **Find:**

```tsx
          finish("danger", "Connection failed", res.error, res.returnTo);
```

   **Replace with:**

```tsx
          finish(
            "danger",
            res.code === "account_limit_reached" ? "Account limit reached" : "Connection failed",
            res.error,
            res.returnTo,
          );
```

3. **Find:**

```tsx
          title: "Facebook Page connection failed",
```

   **Replace with:**

```tsx
          title: "code" in result && result.code === "account_limit_reached" ? "Account limit reached" : "Facebook Page connection failed",
```

   Keep the `"code" in result` guard. `useOAuth` is typed from three engines (Postgres, demo and Convex), and only the Postgres one returns `code`, so without the guard the typecheck fails.

### 7.6 The live landing's Pro line (the only live-landing change)

`apps/web/src/components/ui/ruixen-pricing-04.tsx`: **Find** `["Social Media Scheduler", "Connect up to 100 accounts on each platform"],` and **Replace with** `["Social Media Scheduler", "Connect up to 10 accounts"],`.

---

## 8. Phase 5: the landing's AI FOR SAVAGES card (in AFS's look)

### 8.1 The look, taken from the AFS site itself

The AFS site's own code is the reference: `src/components/home/Plans.tsx`, `NeonAuthButton.tsx`, `src/styles/apple.css` and `HomePageClient.tsx` in `thetimeoperator/aiforsavages`, branch main. Reproduce it as follows:

| Piece | AFS site | On Posterract's card |
|---|---|---|
| Edge | `.ring`: 1.5px ring, overflow hidden, radius 32px; a conic gradient (transparent → `rgba(100,210,255,.9)` 70% → `rgba(191,90,242,.9)` 80% → `rgba(255,159,10,.85)` 88% → transparent) rotating every 6s; shadow `0 30px 90px rgba(0,0,0,.6), 0 0 80px rgba(100,210,255,.1)` | Identical. The purple in the light belongs to AFS's look and appears only on this card. |
| Ground | `#121214` card with a top cyan radial glow, over the space sky | The same, over AFS's own star field (`space-sky.avif`, 43 KB, lazy-loaded) under a dark wash |
| Name | "AI FOR SAVAGES", Inter bold, uppercase, `#f0f6fc`, letter-spacing −0.03em | Same type, sized to the card |
| Line | The signed-out hero line: "You learn how to **ship products** and **go viral**… that’s what you’re getting from this.", highlights `#64d2ff` with a glow | Word for word |
| Plan switch | Capsule `rgba(120,120,128,.24)`, a sliding thumb `rgba(255,255,255,.17)`; "Save $119.89" pill in gold `#ffd76a` | Same, with the saving computed from live prices |
| Price | Silver gradient text (`#fff → #e8e8ed → #a1a1a6`), SF Pro Display 700, `/month` beside it | Same |
| Notes | "Cancel anytime." / "Pay once. Yours for good." | Same |
| Button | Neon cyan: `#00ffff` border, `#00ffff → #000` gradient, uppercase, glow that breathes, a light band that sweeps across | Same look; animated with opacity and transform only (Posterract's smoothness rule) |
| Fine print | "Secure checkout by Stripe" / "No refunds, but you can cancel anytime · All sales are final" | Same; for lifetime "One payment · All sales are final" |
| Perks | "What you get" + six rows with iOS-style gradient icon tiles (amber, Discord blue, yellow, cyan, red, green) | Sina's six lines word for word, same tiles and icons, plus the red live dot on the Sunday call |
| Posterract plate | A small green plate, "FREE POSTERRACT BASE PLAN" | A green plate on top of the perks: "POSTERRACT PRO INCLUDED / Connect up to 100 accounts" |

Layout. Desktop (≥ 901px) shows two columns, max width 1080px, centered under the Pro panel and preceded by a thin "OR" divider. At 900px and below it is one column, max 640px.

```
                      ──────────────────── OR ────────────────────
╭─────────── light travels round this edge (cyan → purple → orange) ───────────╮
│ ✦ star field, dimmed                                                        │
│ AI FOR SAVAGES                          ┌─────────────────────────────────┐ │
│ You learn how to ship products and      │ ■ POSTERRACT PRO INCLUDED       │ │
│ go viral… that’s what you’re getting    │   Connect up to 100 accounts    │ │
│ from this.                              └─────────────────────────────────┘ │
│ ( Monthly | Yearly Save $119.89 | Lifetime )   WHAT YOU GET                 │
│                                          [🚀] Post and share what you build… │
│ $59.99 /month                            [💬] Discord + Access to me         │
│ Cancel anytime.                               ● One Hour Live Discord Call…  │
│ [     JOIN AI FOR SAVAGES  →     ]       [</>] My raw app code files…        │
│ Secure checkout by Stripe                [🗂] My Agent Content Skill Folders… │
│ No refunds, but you can cancel           [📖] My guides + Intro Videos        │
│ anytime · All sales are final            [🎁] FREE Base plans to EVERY…       │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### 8.2 Copy two images from the AFS repo (read-only)

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && mkdir -p apps/web/public/brand/savages && git -C "/Users/sinapahlevan/CODING PROJECTS/aiforsavages-community" show origin/main:public/images/home-space/space-sky.avif > apps/web/public/brand/savages/space-sky.avif && git -C "/Users/sinapahlevan/CODING PROJECTS/aiforsavages-community" show origin/main:public/images/home-space/space-sky.webp > apps/web/public/brand/savages/space-sky.webp && ls -l apps/web/public/brand/savages
```

**Check:** `space-sky.avif` is **42971** bytes and `space-sky.webp` is **60254** bytes.

### 8.3 New file `apps/web/src/styles/savages.css`

Every rule is scoped under `:is(.sv-zone, .sv-page)`. The reason: `game.css` loads after this file and resets `margin` on `h1/h2/h3/p/ul` and `font/color` on `button` at the same specificity. The scope makes these rules win whatever the load order.

```css
/* ---------------------------------------------------------------------------
 * AI FOR SAVAGES inside Posterract: the landing's membership card (.sv-zone)
 * and the welcome page after paying (.sv-page). Its own look on purpose,
 * taken from aiforsavages.fyi (Plans.tsx, NeonAuthButton.tsx, apple.css), so
 * the option stands out from Posterract's green. Only transform and opacity
 * animate; everything stops for reduced motion, and while the card is off
 * screen (data-live="off").
 * ------------------------------------------------------------------------- */

.sv-zone,
.sv-page {
  --sv-label: #f5f5f7;
  --sv-label-2: rgba(235, 235, 245, 0.62);
  --sv-label-3: rgba(235, 235, 245, 0.34);
  --sv-tint: #64d2ff;
  --sv-gold: #ffd76a;
  --sv-orange: #ff9f0a;
  --sv-gray: #7d8590;
  --sv-card: #121214;
  --sv-font: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --sv-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Helvetica Neue", sans-serif;
  --sv-mono: "Fira Code", var(--font-mono), ui-monospace, monospace;
  --sv-spring: cubic-bezier(0.32, 0.72, 0, 1);
}

:is(.sv-zone, .sv-page) *,
:is(.sv-zone, .sv-page) *::before,
:is(.sv-zone, .sv-page) *::after {
  box-sizing: border-box;
}

/* "OR" between Posterract Pro and this card */
:is(.sv-zone, .sv-page) .sv-or {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1080px;
  margin: 40px auto 0;
  color: var(--sv-gray);
  font: 500 11px/1 var(--sv-mono);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
:is(.sv-zone, .sv-page) .sv-or::before,
:is(.sv-zone, .sv-page) .sv-or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(125, 133, 144, 0.45), transparent);
}

/* the card, with a light that travels round its edge */
:is(.sv-zone, .sv-page) .sv-ring {
  position: relative;
  isolation: isolate;
  max-width: 1080px;
  margin: 22px auto 0;
  padding: 1.5px;
  overflow: hidden;
  border-radius: 32px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6), 0 0 80px rgba(100, 210, 255, 0.1);
}
:is(.sv-zone, .sv-page) .sv-ring::before {
  content: "";
  position: absolute;
  inset: -60%;
  background: conic-gradient(
    from 0deg,
    transparent 0 58%,
    rgba(100, 210, 255, 0.9) 70%,
    rgba(191, 90, 242, 0.9) 80%,
    rgba(255, 159, 10, 0.85) 88%,
    transparent 96%
  );
  animation: sv-travel 6s linear infinite;
  will-change: transform;
}
:is(.sv-zone, .sv-page) .sv-card {
  position: relative;
  overflow: hidden;
  border-radius: 30.5px;
  background: var(--sv-card);
  color: var(--sv-label);
  font-family: var(--sv-font);
}
:is(.sv-zone, .sv-page) .sv-card::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    radial-gradient(90% 60% at 50% 0%, rgba(100, 210, 255, 0.1), transparent 70%),
    linear-gradient(180deg, rgba(18, 18, 20, 0.35) 0%, rgba(18, 18, 20, 0.82) 45%, rgba(18, 18, 20, 0.94) 100%);
  pointer-events: none;
}
:is(.sv-zone, .sv-page) .sv-sky {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
:is(.sv-zone, .sv-page) .sv-sky img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 70%;
  opacity: 0.55;
}
:is(.sv-zone, .sv-page) .sv-grid {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 40px;
  padding: 36px 38px 34px;
}

/* name and line */
:is(.sv-zone, .sv-page) .sv-title {
  margin: 0;
  color: #f0f6fc;
  font: 800 clamp(36px, 4.4vw, 60px) / 0.95 var(--sv-font);
  letter-spacing: -0.03em;
  text-transform: uppercase;
  text-wrap: balance;
}
:is(.sv-zone, .sv-page) .sv-lede {
  max-width: 34ch;
  margin: 14px 0 0;
  color: rgba(235, 235, 245, 0.88);
  font: 600 clamp(17px, 1.5vw, 21px) / 1.3 var(--sv-display);
  letter-spacing: -0.02em;
}
:is(.sv-zone, .sv-page) .sv-lede span {
  color: var(--sv-tint);
  font-weight: 800;
  text-shadow: 0 0 18px rgba(100, 210, 255, 0.6), 0 0 42px rgba(100, 210, 255, 0.25);
}
:is(.sv-zone, .sv-page) .sv-lede b {
  display: block;
  margin-top: 4px;
  color: #ffffff;
  font-weight: 700;
}

/* the plan switch: one capsule, a thumb that slides between three segments */
:is(.sv-zone, .sv-page) .sv-switch {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 26px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(120, 120, 128, 0.24);
}
:is(.sv-zone, .sv-page) .sv-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / 3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.17);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  transform: translateX(calc(var(--sv-index) * 100%));
  transition: transform 0.45s var(--sv-spring);
}
:is(.sv-zone, .sv-page) .sv-seg {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(235, 235, 245, 0.62);
  font: 600 14.5px/1 var(--sv-font);
  letter-spacing: -0.01em;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.25s ease;
}
:is(.sv-zone, .sv-page) .sv-seg[aria-checked="true"] {
  color: #f5f5f7;
}
:is(.sv-zone, .sv-page) .sv-seg:focus-visible {
  outline: 3px solid rgba(100, 210, 255, 0.55);
  outline-offset: -1px;
}
:is(.sv-zone, .sv-page) .sv-save {
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(255, 215, 106, 0.18);
  color: var(--sv-gold);
  font: 700 10.5px/1 var(--sv-font);
}

/* the price, re-keyed on every switch so it animates in */
:is(.sv-zone, .sv-page) .sv-price-block {
  margin-top: 26px;
}
:is(.sv-zone, .sv-page) .sv-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  animation: sv-price-in 0.5s var(--sv-spring);
}
:is(.sv-zone, .sv-page) .sv-amount {
  background: linear-gradient(180deg, #ffffff 0%, #e8e8ed 50%, #a1a1a6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  font: 700 clamp(56px, 6.2vw, 80px) / 1 var(--sv-display);
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
}
:is(.sv-zone, .sv-page) .sv-cadence {
  color: var(--sv-label-2);
  font: 500 19px/1 var(--sv-font);
  letter-spacing: -0.01em;
}
:is(.sv-zone, .sv-page) .sv-note {
  min-height: 22px;
  margin: 10px 0 0;
  color: var(--sv-label-2);
  font: 400 16px/1.4 var(--sv-font);
  letter-spacing: -0.01em;
  animation: sv-price-in 0.5s var(--sv-spring);
}
:is(.sv-zone, .sv-page) .sv-note button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--sv-tint);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* the lit neon cyan button; its glow breathes outside it, so the button can clip its sweep */
:is(.sv-zone, .sv-page) .sv-cta {
  position: relative;
  margin-top: 26px;
}
:is(.sv-zone, .sv-page) .sv-cta::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 8px;
  box-shadow: 0 0 34px rgba(0, 255, 255, 0.75);
  opacity: 0.35;
  animation: sv-breathe 2.2s ease-in-out infinite;
  pointer-events: none;
}
:is(.sv-zone, .sv-page) .sv-neon {
  position: relative;
  isolation: isolate;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 12px;
  overflow: hidden;
  padding: 16px 36px;
  border: 1px solid #00ffff;
  border-radius: 8px;
  background: linear-gradient(135deg, #00ffff 0%, #000000 100%);
  color: #ffffff;
  font: 600 16px/1 var(--sv-font);
  letter-spacing: 1px;
  text-decoration: none;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0, 255, 255, 0.85);
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 255, 255, 0.4), inset 0 0 12px rgba(0, 255, 255, 0.22);
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease;
}
:is(.sv-zone, .sv-page) .sv-neon::before {
  /* a hairline of light along the top edge */
  content: "";
  position: absolute;
  top: 0;
  right: 12%;
  left: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), transparent);
  pointer-events: none;
}
:is(.sv-zone, .sv-page) .sv-neon::after {
  /* a band of light that crosses every few seconds */
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 45%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transform: translateX(-160%) skewX(-20deg);
  animation: sv-sweep 3.4s ease-in-out infinite;
  pointer-events: none;
}
:is(.sv-zone, .sv-page) .sv-neon > * {
  position: relative;
  z-index: 1;
}
:is(.sv-zone, .sv-page) .sv-neon svg {
  transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.3, 1);
}
:is(.sv-zone, .sv-page) .sv-neon:hover:not(:disabled),
:is(.sv-zone, .sv-page) .sv-neon:focus-visible {
  border-color: #4ecfff;
  background: linear-gradient(135deg, #4ecfff 0%, #111111 100%);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7), 0 0 44px rgba(0, 255, 255, 0.65), inset 0 0 18px rgba(0, 255, 255, 0.35);
  transform: translateY(-2px);
}
:is(.sv-zone, .sv-page) .sv-neon:hover:not(:disabled) svg {
  transform: translateX(3px);
}
:is(.sv-zone, .sv-page) .sv-neon:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 3px;
}
:is(.sv-zone, .sv-page) .sv-neon:active:not(:disabled) {
  transform: translateY(0);
}
:is(.sv-zone, .sv-page) .sv-neon:disabled {
  cursor: progress;
  opacity: 0.75;
}
:is(.sv-zone, .sv-page) .sv-neon:disabled::after {
  animation: none;
}

:is(.sv-zone, .sv-page) .sv-error {
  margin: 12px 0 0;
  color: var(--sv-orange);
  font: 500 14px/1.4 var(--sv-font);
}
:is(.sv-zone, .sv-page) .sv-fine {
  margin: 14px 0 0;
  color: var(--sv-label-3);
  font: 400 12.5px/1.5 var(--sv-font);
}

/* Posterract, included: its own little green plate, as on aiforsavages.fyi */
:is(.sv-zone, .sv-page) .sv-posterract {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px 12px;
  margin: 0;
  padding: 14px 16px;
  border-radius: 14px;
  background: radial-gradient(120% 140% at 0% 0%, rgba(101, 255, 154, 0.16), transparent 60%), #06100b;
  box-shadow: inset 0 0 0 1px rgba(101, 255, 154, 0.3), 0 0 26px rgba(101, 255, 154, 0.12);
  color: #eafff3;
}
:is(.sv-zone, .sv-page) .sv-posterract-mark {
  grid-row: span 2;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #65ff9a;
  box-shadow: 0 0 10px #65ff9a;
}
:is(.sv-zone, .sv-page) .sv-posterract-name {
  font: 800 12.5px/1 var(--font-display, var(--sv-font));
  letter-spacing: 0.08em;
}
:is(.sv-zone, .sv-page) .sv-posterract-name b {
  color: #65ff9a;
  font-weight: 800;
}
:is(.sv-zone, .sv-page) .sv-posterract-line {
  font: 700 clamp(18px, 1.7vw, 22px) / 1.15 var(--sv-display);
  letter-spacing: -0.02em;
}

/* what you get: one row per reason, an icon tile, the line, its sub-point */
:is(.sv-zone, .sv-page) .sv-cap {
  margin: 24px 0 0;
  color: var(--sv-label-3);
  font: 600 12px/1 var(--sv-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
:is(.sv-zone, .sv-page) .sv-perks {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}
:is(.sv-zone, .sv-page) .sv-perk {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: start;
  gap: 14px;
}
:is(.sv-zone, .sv-page) .sv-tile {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 6px 16px rgba(0, 0, 0, 0.4);
}
:is(.sv-zone, .sv-page) .sv-tile--amber { background: linear-gradient(180deg, #ffb340, #ff8a00); }
:is(.sv-zone, .sv-page) .sv-tile--discord { background: linear-gradient(180deg, #7983f5, #5865f2); }
:is(.sv-zone, .sv-page) .sv-tile--yellow { background: linear-gradient(180deg, #ffe066, #ffc300); color: #1a1400; }
:is(.sv-zone, .sv-page) .sv-tile--cyan { background: linear-gradient(180deg, #64d2ff, #0a84ff); }
:is(.sv-zone, .sv-page) .sv-tile--red { background: linear-gradient(180deg, #ff6961, #ff3b30); }
:is(.sv-zone, .sv-page) .sv-tile--green { background: linear-gradient(180deg, #4cd964, #28a745); }
:is(.sv-zone, .sv-page) .sv-perk-title {
  margin: 0;
  padding-top: 1px;
  color: var(--sv-label);
  font: 600 16px/1.35 var(--sv-font);
  letter-spacing: -0.014em;
  text-wrap: pretty;
}
:is(.sv-zone, .sv-page) .sv-perk-sub {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 6px 0 0;
  color: var(--sv-label-2);
  font: 400 14.5px/1.4 var(--sv-font);
  letter-spacing: -0.01em;
}
:is(.sv-zone, .sv-page) .sv-perk-sub::before {
  content: "↳";
  flex: none;
  color: var(--sv-label-3);
}
:is(.sv-zone, .sv-page) .sv-perk-sub--live::before {
  content: none;
}
:is(.sv-zone, .sv-page) .sv-perk-sub b {
  color: #ffffff;
  font-weight: 700;
}
:is(.sv-zone, .sv-page) .sv-live {
  position: relative;
  flex: none;
  align-self: center;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff3b30;
}
:is(.sv-zone, .sv-page) .sv-live::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(255, 59, 48, 0.6);
  animation: sv-live 1.6s ease-out infinite;
}

/* the welcome page after Stripe */
.sv-page {
  position: relative;
  min-height: 100vh;
  padding: 48px 16px 64px;
  background: #000000;
  color: var(--sv-label);
  font-family: var(--sv-font);
  overflow-x: clip;
}
.sv-page .sv-page-sky {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.sv-page .sv-page-sky img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
}
.sv-page .sv-page-column {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 22px;
  width: min(100%, 560px);
  margin: 0 auto;
}
.sv-page .sv-page-brand {
  color: var(--sv-gray);
  font: 600 11px/1 var(--sv-mono);
  letter-spacing: 0.22em;
  text-decoration: none;
  text-transform: uppercase;
}
.sv-page .sv-page-brand b {
  color: #65ff9a;
  font-weight: 600;
}
.sv-page .sv-ring {
  width: 100%;
  margin: 0;
}
.sv-page .sv-welcome {
  position: relative;
  z-index: 2;
  padding: 30px 28px 28px;
  text-align: center;
}
.sv-page .sv-kicker {
  margin: 0 0 12px;
  color: var(--sv-gray);
  font: 500 11px/1.4 var(--sv-mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.sv-page .sv-welcome h1 {
  margin: 0;
  background: linear-gradient(180deg, #ffffff 0%, #e8e8ed 48%, #a1a1a6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  font: 700 clamp(40px, 9vw, 56px) / 1.04 var(--sv-display);
  letter-spacing: -0.035em;
}
.sv-page .sv-welcome p {
  max-width: 40ch;
  margin: 12px auto 0;
  color: var(--sv-label-2);
  font: 400 16px/1.45 var(--sv-font);
}
.sv-page .sv-welcome strong,
.sv-page .sv-step strong {
  color: #ffffff;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.sv-page .sv-welcome .sv-posterract {
  justify-content: center;
  margin: 18px auto 0;
  text-align: left;
}
.sv-page .sv-spinner {
  display: block;
  width: 28px;
  height: 28px;
  margin: 18px auto 0;
  border: 2px solid rgba(100, 210, 255, 0.2);
  border-top-color: var(--sv-tint);
  border-radius: 50%;
  animation: sv-spin 0.9s linear infinite;
}
.sv-page .sv-step {
  width: 100%;
  padding: 20px 22px;
  border-radius: 22px;
  background: rgba(22, 22, 24, 0.88);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.38);
  text-align: left;
}
.sv-page .sv-step h2 {
  margin: 0;
  color: var(--sv-label-3);
  font: 600 12px/1 var(--sv-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sv-page .sv-step p {
  margin: 8px 0 0;
  color: var(--sv-label-2);
  font: 400 15px/1.45 var(--sv-font);
}
.sv-page .sv-step .sv-cta {
  margin-top: 16px;
}
.sv-page .sv-auth {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

@keyframes sv-travel { to { transform: rotate(360deg); } }
@keyframes sv-breathe { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes sv-sweep {
  0%, 58% { transform: translateX(-160%) skewX(-20deg); }
  100% { transform: translateX(330%) skewX(-20deg); }
}
@keyframes sv-price-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@keyframes sv-live {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(2.75); }
}
@keyframes sv-spin { to { transform: rotate(360deg); } }

/* nothing runs while the card is off screen */
:is(.sv-zone, .sv-page) .sv-ring[data-live="off"]::before,
:is(.sv-zone, .sv-page) .sv-ring[data-live="off"] .sv-cta::before,
:is(.sv-zone, .sv-page) .sv-ring[data-live="off"] .sv-neon::after,
:is(.sv-zone, .sv-page) .sv-ring[data-live="off"] .sv-live::after {
  animation-play-state: paused;
}

@media (max-width: 900px) {
  :is(.sv-zone, .sv-page) .sv-ring { max-width: 640px; }
  :is(.sv-zone, .sv-page) .sv-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 30px;
    padding: 28px 26px 26px;
  }
}

@media (max-width: 640px) {
  :is(.sv-zone, .sv-page) .sv-or { margin-top: 30px; }
  :is(.sv-zone, .sv-page) .sv-ring { border-radius: 26px; }
  :is(.sv-zone, .sv-page) .sv-card { border-radius: 24.5px; }
  :is(.sv-zone, .sv-page) .sv-grid { padding: 22px 18px; }
  :is(.sv-zone, .sv-page) .sv-seg { font-size: 13.5px; }
  :is(.sv-zone, .sv-page) .sv-save { display: none; }
  :is(.sv-zone, .sv-page) .sv-perk-title { font-size: 15px; }
  :is(.sv-zone, .sv-page) .sv-perk-sub { font-size: 13.5px; }
  :is(.sv-zone, .sv-page) .sv-neon { padding: 15px 20px; font-size: 15px; }
  .sv-page .sv-welcome { padding: 24px 18px 22px; }
}

@media (prefers-reduced-motion: reduce) {
  :is(.sv-zone, .sv-page) .sv-ring::before,
  :is(.sv-zone, .sv-page) .sv-cta::before,
  :is(.sv-zone, .sv-page) .sv-neon::after,
  :is(.sv-zone, .sv-page) .sv-live::after,
  :is(.sv-zone, .sv-page) .sv-price,
  :is(.sv-zone, .sv-page) .sv-note,
  .sv-page .sv-spinner {
    animation: none;
  }
  :is(.sv-zone, .sv-page) .sv-thumb,
  :is(.sv-zone, .sv-page) .sv-neon,
  :is(.sv-zone, .sv-page) .sv-neon svg {
    transition: none;
  }
  :is(.sv-zone, .sv-page) .sv-neon:hover:not(:disabled) {
    transform: none;
  }
}
```

### 8.4 New file `apps/web/src/marketing/game/SavagesCard.tsx`

```tsx
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, BookOpen, Code2, FolderTree, Gift, MessagesSquare, Rocket, type LucideIcon } from "lucide-react";
import type { SavagesPlanId } from "@posterract/contract";
import { money, startGuestCheckout, useSavagesPlans, type SavagesPlans } from "@/lib/savages";
import "@/styles/savages.css";

type Plan = { id: SavagesPlanId; name: string; cadence: string; note: string };

/** The three ways to join, named and noted as on aiforsavages.fyi (src/lib/pricing.ts). */
const PLANS: Plan[] = [
  { id: "monthly", name: "Monthly", cadence: "/month", note: "Cancel anytime." },
  { id: "yearly", name: "Yearly", cadence: "/year", note: "Cancel anytime." },
  { id: "lifetime", name: "Lifetime", cadence: "once", note: "Pay once. Yours for good." },
];

type Perk = {
  Icon: LucideIcon;
  tone: "amber" | "discord" | "yellow" | "cyan" | "red" | "green";
  title: string;
  sub?: ReactNode;
  live?: boolean;
};

/** What a member gets: Sina's six reasons, in his words and his order, as on aiforsavages.fyi (Plans.tsx). */
const PERKS: Perk[] = [
  { Icon: Rocket, tone: "amber", title: "Post and share what you build with the community and get users + earn points and level up" },
  { Icon: MessagesSquare, tone: "discord", title: "Discord + Access to me", sub: "One Hour Live Discord Call every Sunday", live: true },
  { Icon: Code2, tone: "yellow", title: "My raw app code files so you can host them yourself" },
  {
    Icon: FolderTree,
    tone: "cyan",
    title: "My Agent Content Skill Folders + Structure",
    sub: "Your agent will be able to run your entire marketing department and make viral videos",
  },
  {
    Icon: BookOpen,
    tone: "red",
    title: "My guides + Intro Videos",
    sub: (
      <>
        the <b>REAL INFORMATION</b> you’re looking for
      </>
    ),
  },
  { Icon: Gift, tone: "green", title: "FREE Base plans to EVERY PRODUCT I RELEASE" },
];

/**
 * The landing's second payment option: AI FOR SAVAGES, in its own look, so it
 * stands out from Posterract Pro above it. The button goes straight to
 * Stripe's checkout page; the buyer gets their Posterract login afterwards,
 * on /savages.
 */
export function SavagesCard({ plans: given }: { plans?: SavagesPlans }) {
  const { plans, failed, retry } = useSavagesPlans(given);
  const [planId, setPlanId] = useState<SavagesPlanId>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ringRef = useRef<HTMLDivElement>(null);

  // The edge light and the button's glow run only while the card is on screen.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      ring.dataset.live = entry.isIntersecting ? "on" : "off";
    });
    observer.observe(ring);
    return () => observer.disconnect();
  }, []);

  const index = PLANS.findIndex((item) => item.id === planId);
  const plan = PLANS[index];
  const amount = plans?.[planId];
  const saving = plans?.monthly && plans.yearly ? plans.monthly * 12 - plans.yearly : undefined;

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      window.location.assign(await startGuestCheckout(planId));
    } catch {
      setBusy(false);
      setError("Couldn’t open checkout. Try again in a minute.");
    }
  };

  return (
    <div className="sv-zone">
      <p className="sv-or">or</p>
      <div className="sv-ring" ref={ringRef} data-live="off">
        <article className="sv-card" aria-labelledby="sv-title">
          <picture className="sv-sky" aria-hidden="true">
            <source srcSet="/brand/savages/space-sky.avif" type="image/avif" />
            <img src="/brand/savages/space-sky.webp" alt="" loading="lazy" decoding="async" />
          </picture>
          <div className="sv-grid">
            <div className="sv-buy">
              <h3 className="sv-title" id="sv-title">
                AI FOR SAVAGES
              </h3>
              <p className="sv-lede">
                You learn how to <span>ship products</span> and <span>go viral</span>…
                <b>that’s what you’re getting from this.</b>
              </p>
              <div
                className="sv-switch"
                role="radiogroup"
                aria-label="AI FOR SAVAGES plan"
                style={{ "--sv-index": index } as CSSProperties}
              >
                <span className="sv-thumb" aria-hidden="true" />
                {PLANS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={item.id === planId}
                    className="sv-seg"
                    onClick={() => setPlanId(item.id)}
                  >
                    {item.name}
                    {item.id === "yearly" && saving !== undefined && saving > 0 && (
                      <span className="sv-save">Save {money(saving)}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="sv-price-block" aria-live="polite">
                <p className="sv-price" key={`price-${planId}`}>
                  <span className="sv-amount">{amount === undefined ? "—" : money(amount)}</span>
                  <span className="sv-cadence">{plan.cadence}</span>
                </p>
                <p className="sv-note" key={`note-${planId}`}>
                  {failed ? (
                    <>
                      Pricing is temporarily unavailable.{" "}
                      <button type="button" onClick={retry}>
                        Try again
                      </button>
                    </>
                  ) : amount === undefined ? (
                    "Loading current pricing…"
                  ) : (
                    plan.note
                  )}
                </p>
              </div>
              <div className="sv-cta">
                <button type="button" className="sv-neon" onClick={() => void join()} disabled={busy} aria-busy={busy}>
                  <span>{busy ? "Opening Stripe…" : "Join AI FOR SAVAGES"}</span>
                  <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>
              {error && (
                <p className="sv-error" role="alert">
                  {error}
                </p>
              )}
              <p className="sv-fine">
                Secure checkout by Stripe
                <br />
                {planId === "lifetime" ? "One payment · All sales are final" : "No refunds, but you can cancel anytime · All sales are final"}
              </p>
            </div>
            <div className="sv-get">
              <p className="sv-posterract">
                <span className="sv-posterract-mark" aria-hidden="true" />
                <span className="sv-posterract-name">
                  POSTER<b>RACT</b> PRO INCLUDED
                </span>
                <span className="sv-posterract-line">Connect up to 100 accounts</span>
              </p>
              <p className="sv-cap">What you get</p>
              <ul className="sv-perks">
                {PERKS.map(({ Icon, tone, title, sub, live }) => (
                  <li className="sv-perk" key={tone}>
                    <span className={`sv-tile sv-tile--${tone}`} aria-hidden="true">
                      <Icon size={18} strokeWidth={2.2} />
                    </span>
                    <div>
                      <p className="sv-perk-title">{title}</p>
                      {sub && (
                        <p className={live ? "sv-perk-sub sv-perk-sub--live" : "sv-perk-sub"}>
                          {live && <span className="sv-live" aria-hidden="true" />}
                          <span>{sub}</span>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
```

### 8.5 `apps/web/src/marketing/game/EnterTheGame.tsx` (unfinished-landing file: edit, never commit)

1. **The account line.** **Find:**

```tsx
  ["Social Media Scheduler", "Connect up to 100 accounts on each platform"],
```

   **Replace with:**

```tsx
  ["Social Media Scheduler", "Connect up to 10 accounts"],
```

2. **Imports.** **Find:**

```tsx
import { usePlanPrices, type PlanPrices } from "./prices";
```

   **Replace with:**

```tsx
import { usePlanPrices, type PlanPrices } from "./prices";
import type { SavagesPlans } from "@/lib/savages";
import { SavagesCard } from "./SavagesCard";
```

3. **The comment above `FEATURES`.** **Find:**

```tsx
/** The one plan, priced live from billing, with the four lines already approved for the pricing card. */
```

   **Replace with:**

```tsx
/** Posterract Pro, priced live from billing, with the four lines approved for the pricing card; then AI FOR SAVAGES (SavagesCard). */
```

4. **Props.** **Find:**

```tsx
export function EnterTheGame({ onStart, prices: given }: { onStart: (selection: BillingSelection) => void; prices?: PlanPrices }) {
```

   **Replace with:**

```tsx
export function EnterTheGame({
  onStart,
  prices: given,
  savagesPlans,
}: {
  onStart: (selection: BillingSelection) => void;
  prices?: PlanPrices;
  savagesPlans?: SavagesPlans;
}) {
```

5. **The card, under the Pro panel.** At the very end of the component's JSX, **Find:**

```tsx
      </article>
    </section>
```

   **Replace with:**

```tsx
      </article>
      <SavagesCard plans={savagesPlans} />
    </section>
```

Leave the section's header as it is: the kicker, "One plan. The whole game." and its paragraph. Only the founder changes approved copy. If he asks, the header is in this file.

### 8.6 `apps/web/src/marketing/game/GameLanding.tsx` (unfinished-landing file: edit, never commit)

1. **Find:**

```tsx
import type { PlanPrices } from "./prices";
```

   **Replace with:**

```tsx
import type { PlanPrices } from "./prices";
import type { SavagesPlans } from "@/lib/savages";
```

2. **Find:**

```tsx
export function GameLanding({ feed: givenFeed, prices }: { feed?: GameFeed; prices?: PlanPrices }) {
```

   **Replace with:**

```tsx
export function GameLanding({
  feed: givenFeed,
  prices,
  savagesPlans,
}: {
  feed?: GameFeed;
  prices?: PlanPrices;
  savagesPlans?: SavagesPlans;
}) {
```

3. **Find:**

```tsx
            <EnterTheGame prices={prices} onStart={(selection) => openAuth("signup", selection)} />
```

   **Replace with:**

```tsx
            <EnterTheGame prices={prices} savagesPlans={savagesPlans} onStart={(selection) => openAuth("signup", selection)} />
```

### 8.7 `apps/web/preview-game/main.tsx` (local preview, excluded from git)

**Find:**

```tsx
<GameLanding feed={feed as GameFeed} prices={{ monthly: 2000, yearly: 20000 }} />
```

**Replace with:**

```tsx
<GameLanding feed={feed as GameFeed} prices={{ monthly: 2000, yearly: 20000 }} savagesPlans={{ monthly: 5999, yearly: 59999, lifetime: 200000 }} />
```

The founder's open preview (port 5189) picks this up live. In the preview, the Join button shows "Couldn’t open checkout…" because the preview has no API. That is expected; never point the preview at production.

---

## 9. Phase 6: the welcome page after paying

### 9.1 `apps/web/src/components/ui/welcome-auth-card.tsx`: prefill the email

1. **Find:**

```tsx
  initialMode?: WelcomeAuthMode;
```

   **Replace with:**

```tsx
  initialMode?: WelcomeAuthMode;
  /** Prefills the email. The AI FOR SAVAGES welcome page passes the email the buyer paid with. */
  initialEmail?: string;
```

2. **Find:**

```tsx
  initialMode = "signin",
```

   **Replace with:**

```tsx
  initialMode = "signin",
  initialEmail = "",
```

3. **Find:**

```tsx
  const [email, setEmail] = useState("");
```

   **Replace with:**

```tsx
  const [email, setEmail] = useState(initialEmail);
```

### 9.2 New file `apps/web/src/routes/savages.tsx`

```tsx
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { SavagesCheckoutStatusDTO, SavagesPlanId } from "@posterract/contract";
import { WelcomeAuthCard } from "@/components/ui/welcome-auth-card";
import { savagesApiBase } from "@/lib/savages";
import { useAuthState } from "@/lib/useAuthState";
import "@/styles/savages.css";

type WelcomeSearch = { session_id?: string };

export const Route = createFileRoute("/savages")({
  validateSearch: (search: Record<string, unknown>): WelcomeSearch =>
    typeof search.session_id === "string" ? { session_id: search.session_id } : {},
  component: SavagesWelcome,
});

const PLAN_NAMES: Record<SavagesPlanId, string> = { monthly: "monthly", yearly: "yearly", lifetime: "lifetime" };
const SUPPORT_EMAIL = "pahlevansina@gmail.com";
/** AI FOR SAVAGES' own sign-up, then its welcome flow (?onboarding=1 replays it). */
const AFS_SIGN_UP = `https://www.aiforsavages.fyi/sign-up?redirect_url=${encodeURIComponent("https://www.aiforsavages.fyi/?onboarding=1")}`;

/**
 * Where Stripe sends someone who bought AI FOR SAVAGES from the landing page.
 * It asks the API how the payment stands (which also records it if Stripe's
 * webhook is late), then gets them a Posterract login on the email they paid
 * with: that email is what ties the membership to them.
 */
function SavagesWelcome() {
  const { session_id: sessionId } = Route.useSearch();
  const { isAuthenticated, user } = useAuthState();
  const [status, setStatus] = useState<SavagesCheckoutStatusDTO>({ state: sessionId ? "pending" : "invalid" });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let attempt = 0;
    let timer = 0;
    const check = async () => {
      attempt += 1;
      try {
        const response = await fetch(`${savagesApiBase()}/v1/savages/checkout/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as SavagesCheckoutStatusDTO | null;
        if (stopped) return;
        if (response.status === 400) {
          setStatus({ state: "invalid" });
          return;
        }
        if (response.ok && data) {
          setStatus(data);
          if (data.state !== "pending") return;
        }
      } catch {
        // offline for a moment: ask again
      }
      if (stopped) return;
      if (attempt >= 8) setSlow(true);
      if (attempt < 40) timer = window.setTimeout(() => void check(), attempt < 8 ? 2_000 : 5_000);
    };
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  const email = status.email ?? undefined;
  const signedInEmail = user?.email?.toLowerCase();
  const paid = status.state === "active" || status.state === "already_member";

  return (
    <main className="sv-page">
      <picture className="sv-page-sky" aria-hidden="true">
        <source srcSet="/brand/savages/space-sky.avif" type="image/avif" />
        <img src="/brand/savages/space-sky.webp" alt="" decoding="async" />
      </picture>
      <div className="sv-page-column">
        <a className="sv-page-brand" href="/">
          POSTER<b>RACT</b> × AI FOR SAVAGES
        </a>

        <div className="sv-ring" data-live="on">
          <section className="sv-card">
            <div className="sv-welcome" aria-live="polite">
              {status.state === "pending" && (
                <>
                  <p className="sv-kicker">Stripe · confirming</p>
                  <h1>One second…</h1>
                  <p>{slow ? "Stripe is still confirming your payment. This page updates by itself." : "Confirming your payment with Stripe."}</p>
                  <span className="sv-spinner" aria-hidden="true" />
                </>
              )}
              {status.state === "active" && (
                <>
                  <p className="sv-kicker">AI FOR SAVAGES · payment received</p>
                  <h1>You’re in.</h1>
                  <p>
                    Your {status.plan ? `${PLAN_NAMES[status.plan]} ` : ""}membership is active for <strong>{email}</strong>.
                  </p>
                  <p className="sv-posterract">
                    <span className="sv-posterract-mark" aria-hidden="true" />
                    <span className="sv-posterract-name">
                      POSTER<b>RACT</b> PRO INCLUDED
                    </span>
                    <span className="sv-posterract-line">Connect up to 100 accounts</span>
                  </p>
                </>
              )}
              {status.state === "already_member" && (
                <>
                  <p className="sv-kicker">AI FOR SAVAGES</p>
                  <h1>You were already in.</h1>
                  <p>
                    <strong>{email}</strong> already had a membership, so this payment didn’t change anything. Email{" "}
                    <strong>{SUPPORT_EMAIL}</strong> about it.
                  </p>
                </>
              )}
              {status.state === "needs_help" && (
                <>
                  <p className="sv-kicker">AI FOR SAVAGES · payment received</p>
                  <h1>Almost there.</h1>
                  <p>
                    Stripe didn’t give us your email. Email <strong>{SUPPORT_EMAIL}</strong> with the email you paid with and we’ll attach your
                    membership.
                  </p>
                </>
              )}
              {status.state === "invalid" && (
                <>
                  <p className="sv-kicker">AI FOR SAVAGES</p>
                  <h1>We couldn’t find that checkout.</h1>
                  <p>If you paid, your membership is already on the email you used at Stripe: sign in to Posterract with it.</p>
                  <div className="sv-cta">
                    <a className="sv-neon" href="/gate?mode=signin">
                      <span>Sign in to Posterract</span>
                      <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
                    </a>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {paid && email && (isAuthenticated ? (
          <section className="sv-step">
            <h2>Posterract</h2>
            {signedInEmail === email ? (
              <p>You’re signed in as {email}. Your workspace can connect up to 100 accounts.</p>
            ) : (
              <p>
                You’re signed in as {user?.email}, but the membership is on <strong>{email}</strong>. Sign out, then sign in with {email} to use it.
              </p>
            )}
            <div className="sv-cta">
              <a className="sv-neon" href="/portals">
                <span>Open Posterract</span>
                <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
              </a>
            </div>
          </section>
        ) : (
          <section className="sv-step">
            <h2>Step 1 · Your Posterract login</h2>
            <p>
              {status.hasPosterractLogin ? "Sign in" : "Create your login"} with <strong>{email}</strong>, the email you paid with. That’s what ties the
              membership to you. Use Google only if your Google account is {email}.
            </p>
            <div className="sv-auth">
              <WelcomeAuthCard
                initialMode={status.hasPosterractLogin ? "signin" : "signup"}
                initialEmail={email}
                successUrl="/"
                onSuccess={() => window.location.assign("/")}
              />
            </div>
          </section>
        ))}

        {status.state === "active" && (
          <section className="sv-step">
            <h2>{isAuthenticated ? "AI FOR SAVAGES" : "Step 2 · AI FOR SAVAGES"}</h2>
            <p>Sign up on aiforsavages.fyi with the same email to get into the Discord and everything else in the membership.</p>
            <div className="sv-cta">
              <a className="sv-neon" href={AFS_SIGN_UP} target="_blank" rel="noreferrer">
                <span>Open AI FOR SAVAGES</span>
                <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
```

### 9.3 Regenerate the route list

`apps/web/src/routeTree.gen.ts` is generated by the TanStack Router Vite plugin. Run `pnpm --filter @posterract/web build` once; it rewrites the file to include `/savages`. Never edit that file by hand.

**Check:** `git diff apps/web/src/routeTree.gen.ts` shows only additions for `/savages` (`SavagesRoute`, its import and its entries). If it shows any other route, that route belongs to someone else's unfinished work in this checkout. Stop and tell the founder before deploying.

### 9.4 New e2e test `apps/web/tests/billing/savages.spec.ts`

This runs under `playwright.billing.config.ts`, which uses `VITE_API_URL=http://127.0.0.1:5175/api` and mocks every API call. No real API, Stripe or Hub is involved.

```ts
import { expect, test, type Page } from "@playwright/test";

const session = {
  session: {
    id: "session_test",
    token: "token_test",
    userId: "user_test",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  user: {
    id: "user_test",
    email: "paid@example.test",
    emailVerified: true,
    name: "Paid Test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

const plans = [
  { id: "monthly", amount: 5999, currency: "usd", interval: "month" },
  { id: "yearly", amount: 59999, currency: "usd", interval: "year" },
  { id: "lifetime", amount: 200000, currency: "usd", interval: null },
];

const PROVIDERS = ["instagram", "tiktok", "facebook", "threads"] as const;
const tenAccounts = Array.from({ length: 10 }, (_, index) => ({
  id: `acct_${index}`,
  workspaceId: "workspace_test",
  provider: PROVIDERS[index % PROVIDERS.length],
  providerAccountId: `pid_${index}`,
  handle: `@player${index}`,
  scopes: [],
  status: "connected",
}));

async function signedOut(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/v1/auth/config", (route) =>
    route.fulfill({ json: { providers: { google: true, emailVerification: true, magicLink: false } } }),
  );
}

const billingConfig = {
  configured: true,
  publishableKey: "pk_live_test",
  productId: "prod_test",
  plans: {
    monthly: { priceId: "price_monthly", amount: 2_000, currency: "usd", interval: "month" },
    yearly: { priceId: "price_yearly", amount: 20_000, currency: "usd", interval: "year" },
  },
};

async function signedInAtTheLimit(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: session }));
  // Without this the billing gate stops at "Billing check unavailable".
  await page.route("**/v1/billing/config", (route) => route.fulfill({ json: billingConfig }));
  await page.route("**/v1/billing/subscription", (route) =>
    route.fulfill({
      json: { status: "active", accessState: "active", entitled: true, entitledVia: "subscription", plan: { id: "pro", interval: "month", currency: "usd", unitAmount: 2_000 }, cancelAtPeriodEnd: false },
    }),
  );
  await page.route("**/v1/bootstrap", (route) =>
    route.fulfill({
      json: {
        workspaceId: "workspace_test",
        artifacts: [],
        transmissions: [],
        projections: [],
        events: [],
        portals: tenAccounts,
        businesses: [],
        accountSets: [],
        points: { lifetimeRP: 0, weekRP: 0, streakDays: 0, badges: [], recent: [] },
        accountLimit: { plan: "pro", max: 10, used: 10 },
      },
    }),
  );
  await page.route("**/v1/accounts/refresh-profiles", (route) => route.fulfill({ json: { checked: 10, refreshed: 10, failures: [] } }));
  await page.route("**/v1/savages/plans", (route) => route.fulfill({ json: { plans } }));
}

test("after paying, the welcome page confirms the membership and offers the login on that email", async ({ page }) => {
  await signedOut(page);
  let asked = 0;
  await page.route("**/v1/savages/checkout/cs_live_*", (route) => {
    asked += 1;
    return route.fulfill({
      json:
        asked === 1
          ? { state: "pending", email: "buyer@example.test", plan: "monthly" }
          : { state: "active", email: "buyer@example.test", plan: "monthly", hasPosterractLogin: false },
    });
  });
  await page.goto("/savages?session_id=cs_live_a1b2c3d4e5f6g7h8");
  await expect(page.getByRole("heading", { name: "You’re in." })).toBeVisible();
  await expect(page.getByText("Your monthly membership is active for")).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com").first()).toHaveValue("buyer@example.test");
  await expect(page.getByRole("link", { name: /Open AI FOR SAVAGES/ })).toHaveAttribute("href", /aiforsavages\.fyi\/sign-up/);
});

test("a buyer whose email already has a login is asked to sign in", async ({ page }) => {
  await signedOut(page);
  await page.route("**/v1/savages/checkout/cs_live_*", (route) =>
    route.fulfill({ json: { state: "active", email: "back@example.test", plan: "yearly", hasPosterractLogin: true } }),
  );
  await page.goto("/savages?session_id=cs_live_a1b2c3d4e5f6g7h8");
  await expect(page.locator(".sv-step").first()).toContainText("Sign in with back@example.test");
});

test("without a checkout the welcome page says so and offers sign-in", async ({ page }) => {
  await signedOut(page);
  await page.goto("/savages");
  await expect(page.getByRole("heading", { name: "We couldn’t find that checkout." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in to Posterract/ })).toHaveAttribute("href", "/gate?mode=signin");
});

test("at Pro's ten accounts, connecting is off and AI FOR SAVAGES is one click to Stripe", async ({ page }) => {
  await signedInAtTheLimit(page);
  let body: unknown;
  await page.route("**/v1/savages/checkout/member", async (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { url: "http://127.0.0.1:5175/stripe-checkout-test" } });
  });
  await page.goto("/portals");
  await expect(page.getByRole("heading", { name: "10 of 10 accounts" })).toBeVisible();
  await expect(page.getByText("All 10 of your Pro account slots are in use.")).toBeVisible();
  for (const button of await page.getByRole("button", { name: "Limit reached" }).all()) {
    await expect(button).toBeDisabled();
  }
  await page.getByRole("button", { name: "$59.99/mo" }).click();
  await expect(page).toHaveURL(/stripe-checkout-test/);
  expect(body).toEqual({ plan: "monthly" });
});
```

If the Portals test fails because the page asks for an endpoint this spec doesn't mock, read the browser console in the trace and add a `page.route` for that endpoint. Do not loosen the assertions.

**Check:** `cd apps/web && npx playwright test -c playwright.billing.config.ts` passes, including the existing `billing-gate.spec.ts`.

---

## 10. Phase 7: check everything locally, then show the founder

### 10.1 All of these must pass

Run from the repo root (`/Users/sinapahlevan/CODING PROJECTS/vidtryx`):

```bash
pnpm --filter @posterract/api test
```

```bash
cd apps/hub && node --test test/guest-checkout.test.js
```

```bash
pnpm --filter @posterract/contract typecheck
```

```bash
pnpm --filter @posterract/web build
```

```bash
pnpm --filter @posterract/web typecheck
```

```bash
cd apps/web && npx playwright test -c playwright.billing.config.ts
```

Known failures that are **not** yours (checked on untouched main, Oct 8 2026):
- In the billing suite, `billing-gate.spec.ts:46` "an authenticated unpaid user sees the locked payment popup before app data loads" fails on main every run on this Mac.
- In the billing suite, `billing-gate.spec.ts:132` "failed payments on an active subscription…" sometimes fails when run with the others and passes alone.
- In the main e2e suite (`pnpm --filter @posterract/web test:e2e`), `analytics.spec.ts` "six signal chambers" fails on main, and `tiktok-compose.spec.ts:197` is flaky under parallel load and passes alone.

Any other failure is yours to fix. All four tests in the new `savages.spec.ts` must pass.

### 10.2 Look at it

1. Start the preview with the `game-preview` entry (port 5188). Do not touch the founder's 5189 server.
2. Open `http://127.0.0.1:5188/preview-game/` and scroll to the payment section (`#enter`).
3. Take screenshots at **1440px wide** and at **390px wide**. Check:
   - The Pro panel looks exactly as before, except that its line now reads "Connect up to 10 accounts".
   - The "OR" divider and the AFS card sit below it, and the light travels round the card's edge.
   - Monthly / Yearly / Lifetime switch the price: $59.99 /month, $599.99 /year, $2,000 once. "Save $119.89" shows on Yearly at desktop width.
   - On a phone the card is one column, with no sideways scrolling, and the button fits.
   - With reduced motion turned on, nothing moves.
   - **Do not click Join.**
4. Get screenshots of the welcome page ("You're in.") and the Portals limit notice. Add `await page.screenshot({ path: "test-results/<name>.png", fullPage: true });` at the end of the matching tests in `savages.spec.ts`, run them, take the PNGs, then **remove those lines** again.
5. **Show the founder the screenshots** and wait. Change only what he names. Do not deploy before he says to make it live.

---

## 11. Phase 8: deploy (only when the founder says to make it live)

The order is Hub, then Posterract API, then web. Each one is safe on its own: the Hub's new code acts only on sessions this plan creates, and the API's new routes only call the Hub.

The **landing card is not deployed**: it is part of the unfinished new landing, which goes live when the founder approves that landing. Everything else goes live now. That includes the limits, the in-app upgrade, the welcome page, the checkout API and the live landing's corrected line.

### 11.1 Before any sync: is the VPS what HEAD says?

For every file you will overwrite, compare the VPS copy with `git show HEAD:<file>`. Run this from the repo root:

```bash
for f in apps/hub/src/billing.js apps/hub/src/server.js deploy/aiforsavages/compose.yaml; do printf "%s  local-HEAD=%s  vps=%s\n" "$f" "$(git show HEAD:$f | md5 -q)" "$(ssh root@100.93.122.0 "md5sum /srv/aiforsavages/source/$f" | cut -d' ' -f1)"; done
```

```bash
for f in apps/api/src/oauth.js apps/api/src/server.js packages/contract/src/index.ts deploy/posterract/compose.yaml apps/web/src/engine/postgres.ts apps/web/src/engine/useEngine.ts apps/web/src/routes/_app/portals.tsx 'apps/web/src/routes/oauth.callback.$provider.tsx' apps/web/src/components/ui/welcome-auth-card.tsx apps/web/src/components/ui/ruixen-pricing-04.tsx apps/web/src/routeTree.gen.ts; do printf "%s  local-HEAD=%s  vps=%s\n" "$f" "$(git show "HEAD:$f" | md5 -q)" "$(ssh root@100.93.122.0 "md5sum '/srv/posterract/source/$f'" | cut -d' ' -f1)"; done
```

Every pair must match. **If any differs, stop.** Someone deployed work that isn't in git. Show the founder which files differ and do nothing until he decides.

### 11.2 Deploy the Hub

```bash
ssh root@100.93.122.0 'cd /srv/aiforsavages && tar czf backups/hub-before-savages-$(date -u +%Y%m%dT%H%M%SZ).tgz source/apps/hub/src source/deploy/aiforsavages/compose.yaml && ls -t backups | head -1'
```

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && rsync -Rlcn --itemize-changes apps/hub/src/billing.js apps/hub/src/server.js deploy/aiforsavages/compose.yaml root@100.93.122.0:/srv/aiforsavages/source/
```

The dry run must list exactly those three files. Then run the real sync:

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && rsync -Rlc apps/hub/src/billing.js apps/hub/src/server.js deploy/aiforsavages/compose.yaml root@100.93.122.0:/srv/aiforsavages/source/
```

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && md5 -r apps/hub/src/billing.js apps/hub/src/server.js deploy/aiforsavages/compose.yaml && ssh root@100.93.122.0 'cd /srv/aiforsavages/source && md5sum apps/hub/src/billing.js apps/hub/src/server.js deploy/aiforsavages/compose.yaml'
```

```bash
ssh root@100.93.122.0 'cd /srv/aiforsavages/source && docker compose --env-file /srv/aiforsavages/.env -f deploy/aiforsavages/compose.yaml build hub && docker compose --env-file /srv/aiforsavages/.env -f deploy/aiforsavages/compose.yaml up -d --wait hub && docker compose --env-file /srv/aiforsavages/.env -f deploy/aiforsavages/compose.yaml ps hub && curl -fsS http://127.0.0.1:3003/health'
```

**Check:** the health line is `{"ok":true,"database":"up"}`, and this answers `401`:

```bash
ssh root@100.93.122.0 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/v1/service/posterract/plans'
```

### 11.3 Give Posterract the Hub's key (never shown)

This copies the `HUB_SERVICE_KEY=` line from the Hub's env file into Posterract's and adds the internal URL. It prints only a count.

```bash
ssh root@100.93.122.0 'set -e; cp -p /srv/posterract/.env /srv/posterract/backups/env-before-savages-$(date -u +%Y%m%dT%H%M%SZ); [ -z "$(tail -c1 /srv/posterract/.env)" ] || echo >> /srv/posterract/.env; grep -q "^HUB_SERVICE_KEY=" /srv/posterract/.env || grep "^HUB_SERVICE_KEY=" /srv/aiforsavages/.env >> /srv/posterract/.env; grep -q "^HUB_INTERNAL_URL=" /srv/posterract/.env || echo "HUB_INTERNAL_URL=http://hub:3003" >> /srv/posterract/.env; grep -c -E "^(HUB_SERVICE_KEY|HUB_INTERNAL_URL)=" /srv/posterract/.env'
```

**Check:** it prints `2`.

### 11.4 Deploy the Posterract API and web

The files are everything this plan changed outside the unfinished landing. The same list appears in the dry run and in the real sync. Copy it exactly both times.

Dry run:

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && rsync -Rlcn --itemize-changes apps/api/src/accountLimits.js apps/api/src/savages.js apps/api/src/oauth.js apps/api/src/server.js packages/contract/src/index.ts deploy/posterract/compose.yaml apps/web/src/engine/postgres.ts apps/web/src/engine/useEngine.ts apps/web/src/lib/savages.ts apps/web/src/styles/savages.css apps/web/src/routes/_app/portals.tsx 'apps/web/src/routes/oauth.callback.$provider.tsx' apps/web/src/routes/savages.tsx apps/web/src/routeTree.gen.ts apps/web/src/components/ui/welcome-auth-card.tsx apps/web/src/components/ui/ruixen-pricing-04.tsx apps/web/public/brand/savages/space-sky.avif apps/web/public/brand/savages/space-sky.webp root@100.93.122.0:/srv/posterract/source/
```

The dry run must list exactly those 18 files, with the new ones marked as created. Then back up the VPS copies:

```bash
ssh root@100.93.122.0 'cd /srv/posterract/source && tar czf /srv/posterract/backups/savages-before-$(date -u +%Y%m%dT%H%M%SZ).tgz --ignore-failed-read apps/api/src/oauth.js apps/api/src/server.js packages/contract/src/index.ts deploy/posterract/compose.yaml apps/web/src/engine/postgres.ts apps/web/src/engine/useEngine.ts apps/web/src/routes/_app/portals.tsx "apps/web/src/routes/oauth.callback.\$provider.tsx" apps/web/src/routeTree.gen.ts apps/web/src/components/ui/welcome-auth-card.tsx apps/web/src/components/ui/ruixen-pricing-04.tsx && ls -t /srv/posterract/backups | head -1'
```

Real sync, with the same list and no `n`:

```bash
cd "/Users/sinapahlevan/CODING PROJECTS/vidtryx" && rsync -Rlc apps/api/src/accountLimits.js apps/api/src/savages.js apps/api/src/oauth.js apps/api/src/server.js packages/contract/src/index.ts deploy/posterract/compose.yaml apps/web/src/engine/postgres.ts apps/web/src/engine/useEngine.ts apps/web/src/lib/savages.ts apps/web/src/styles/savages.css apps/web/src/routes/_app/portals.tsx 'apps/web/src/routes/oauth.callback.$provider.tsx' apps/web/src/routes/savages.tsx apps/web/src/routeTree.gen.ts apps/web/src/components/ui/welcome-auth-card.tsx apps/web/src/components/ui/ruixen-pricing-04.tsx apps/web/public/brand/savages/space-sky.avif apps/web/public/brand/savages/space-sky.webp root@100.93.122.0:/srv/posterract/source/
```

Compare md5s for every file in the list, local against VPS, as in 11.2. Then follow AGENTS.md:

```bash
ssh root@100.93.122.0 'cd /srv/posterract/source && docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml build api web && docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml up -d --no-deps api web && docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml ps api web && curl -fsS http://127.0.0.1:3000/health/ready'
```

**Check:** `api` and `web` are healthy and `/health/ready` answers OK.

---

## 12. Phase 9: prove it in production

1. **Prices through the whole chain** (web → API → Hub → Stripe):

```bash
curl -fsS https://www.posterract.app/v1/savages/plans
```

   It must show amounts 5999, 59999 and 200000.

2. **A real Stripe page.** This creates an unpaid session, which expires on its own in 24 hours:

```bash
curl -fsS -X POST -H 'content-type: application/json' -d '{"plan":"monthly"}' https://www.posterract.app/v1/savages/checkout
```

   It must return `{"url":"https://checkout.stripe.com/c/pay/cs_live_…"}`.

3. **What that session holds.** Read it back inside the Hub container, which already has the key, so no secret is shown. Replace `CS_ID` with the `cs_live_…` part of the URL, from `cs_` up to the `#`:

```bash
ssh root@100.93.122.0 'docker exec -i -w /app aiforsavages-hub-1 node --input-type=module -' <<'JS'
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-05-28.basil" });
const session = await stripe.checkout.sessions.retrieve("CS_ID", { expand: ["line_items"] });
console.log(JSON.stringify({
  mode: session.mode,
  metadata: session.metadata,
  price_is_monthly: session.line_items.data[0].price.id === process.env.AFS_STRIPE_PRICE_MONTHLY,
  methods: session.payment_method_types,
  success: session.success_url,
  cancel: session.cancel_url,
}));
JS
```

   Expect:
   - `mode` is `subscription`
   - metadata is exactly `{product, plan, flow: "posterract_guest"}`
   - `price_is_monthly` is true
   - methods is `["card"]`
   - success is `https://www.posterract.app/savages?session_id={CHECKOUT_SESSION_ID}`

4. **The welcome page's question for that unpaid session:**

```bash
curl -fsS https://www.posterract.app/v1/savages/checkout/CS_ID
```

   It must answer `{"state":"pending",…}`.

5. **Limits.** This read-only query prints one `member|used` line per workspace with accounts, and nothing personal:

```bash
ssh root@100.93.122.0 'docker exec -i posterract-postgres-1 sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At"' <<'SQL'
select (u.email_verified and core.has_membership(u.id, 'aiforsavages')) as member,
       count(a.id) filter (where a.provider_account_id is not null and a.status <> 'disconnected') as used
from workspaces w
join app_users u on u.id = w.owner_id
left join social_accounts a on a.workspace_id = w.id
group by w.id, u.email_verified, u.id
having count(a.id) filter (where a.provider_account_id is not null and a.status <> 'disconnected') > 0
order by used desc;
SQL
```

   No line may read `f|` with a number above 10. On Oct 8 2026 the top line was `t|15`.

6. **A real purchase is the founder's call.** If he wants one before the new landing is live, give him a fresh URL from step 2. He pays, checks that he lands on "You're in." with his email, makes the login, and sees "x of 100 accounts". He then cancels and refunds himself in Stripe. Never enter card details yourself.

7. Tell the founder in a few lines: what is live, what isn't (the landing card waits for the new landing), and the results of the checks above.

---

## 13. Rollback

- **Hub:**

```bash
ssh root@100.93.122.0 'cd /srv/aiforsavages && tar xzf backups/<hub-before-savages-…>.tgz -C /srv/aiforsavages && cd source && docker compose --env-file /srv/aiforsavages/.env -f deploy/aiforsavages/compose.yaml build hub && docker compose --env-file /srv/aiforsavages/.env -f deploy/aiforsavages/compose.yaml up -d --wait hub'
```

- **Posterract:**
  1. Restore the backed-up files: `tar xzf /srv/posterract/backups/<savages-before-…>.tgz -C /srv/posterract/source`.
  2. Move the new files (`accountLimits.js`, `savages.js`, `lib/savages.ts`, `styles/savages.css`, `routes/savages.tsx`, `public/brand/savages/`) into `/srv/posterract/backups/savages-rolled-back/`. Do not delete them.
  3. Rebuild `api` and `web` as in 11.4.
- **Env:** copy `/srv/posterract/backups/env-before-savages-…` back to `/srv/posterract/.env`, then recreate `api`.
- No database change needs undoing. This plan adds no migration. Rows written by real purchases are real customers and must stay.

---

## 14. After the founder confirms production: commit and push

Only when he says so. Commit **only** these files, in one commit, and never the unfinished landing:

- `apps/api/src/accountLimits.js`, `apps/api/src/savages.js`, `apps/api/src/oauth.js`, `apps/api/src/server.js`
- `apps/api/test/account-limits.test.js`, `apps/api/test/savages.test.js`
- `apps/hub/src/billing.js`, `apps/hub/src/server.js`, `apps/hub/test/guest-checkout.test.js`
- `packages/contract/src/index.ts`
- `deploy/posterract/compose.yaml`, `deploy/aiforsavages/compose.yaml`
- `apps/web/src/engine/postgres.ts`, `apps/web/src/engine/useEngine.ts`, `apps/web/src/lib/savages.ts`, `apps/web/src/styles/savages.css`
- `apps/web/src/routes/_app/portals.tsx`, `apps/web/src/routes/oauth.callback.$provider.tsx`, `apps/web/src/routes/savages.tsx`, `apps/web/src/routeTree.gen.ts`
- `apps/web/src/components/ui/welcome-auth-card.tsx`, `apps/web/src/components/ui/ruixen-pricing-04.tsx`
- `apps/web/public/brand/savages/space-sky.avif`, `apps/web/public/brand/savages/space-sky.webp`
- `apps/web/tests/billing/savages.spec.ts`
- `docs/account-limits-and-savages-checkout-plan.md`

Do **not** commit:
- `apps/web/src/marketing/game/*` (including `SavagesCard.tsx`), `EnterTheGame.tsx` and `GameLanding.tsx`
- `apps/web/src/styles/game.css`, `apps/web/preview-game/*`
- `apps/hub/node_modules/*`
- `.claude/launch.json`
- anything else listed in 0.1.5

Before committing, prove the commit builds without the unfinished landing:
1. Check HEAD out into a separate `git worktree`.
2. Symlink `node_modules` for every `packages/*` and `apps/*` that has one.
3. Run the API tests, the Hub's new test, and the web build and typecheck there.

---

## 15. Done means

- [ ] All checks in 10.1 pass. Any failure that isn't yours is named.
- [ ] The founder saw the screenshots and said to make it live.
- [ ] Hub, API and web are deployed and healthy (11.2, 11.4).
- [ ] Production checks 12.1–12.5 passed.
- [ ] The founder was told what is live and what waits for the new landing.
- [ ] Commit and push happened only after he confirmed, and with only the files in section 14.

---

## Appendix A: every file

| File | New / edit | Deployed now | Committed |
|---|---|---|---|
| `apps/api/src/accountLimits.js` | new | yes | yes |
| `apps/api/src/oauth.js` | edit | yes | yes |
| `apps/api/src/server.js` | edit | yes | yes |
| `apps/api/src/savages.js` | new | yes | yes |
| `apps/api/test/account-limits.test.js` | new | — | yes |
| `apps/api/test/savages.test.js` | new | — | yes |
| `apps/hub/src/billing.js` | edit | yes (Hub) | yes |
| `apps/hub/src/server.js` | edit | yes (Hub) | yes |
| `apps/hub/test/guest-checkout.test.js` | new | — | yes |
| `apps/hub/node_modules/@electric-sql` | local symlink | — | never |
| `packages/contract/src/index.ts` | edit | yes | yes |
| `deploy/posterract/compose.yaml` | edit | yes | yes |
| `deploy/aiforsavages/compose.yaml` | edit | yes (Hub) | yes |
| `/srv/posterract/.env` | 2 lines added on the VPS | yes | never |
| `apps/web/src/engine/postgres.ts` | edit | yes | yes |
| `apps/web/src/engine/useEngine.ts` | edit | yes | yes |
| `apps/web/src/lib/savages.ts` | new | yes | yes |
| `apps/web/src/styles/savages.css` | new | yes | yes |
| `apps/web/src/routes/_app/portals.tsx` | edit | yes | yes |
| `apps/web/src/routes/oauth.callback.$provider.tsx` | edit | yes | yes |
| `apps/web/src/routes/savages.tsx` | new | yes | yes |
| `apps/web/src/routeTree.gen.ts` | regenerated | yes | yes |
| `apps/web/src/components/ui/welcome-auth-card.tsx` | edit | yes | yes |
| `apps/web/src/components/ui/ruixen-pricing-04.tsx` | one line | yes | yes |
| `apps/web/public/brand/savages/space-sky.{avif,webp}` | new (copied) | yes | yes |
| `apps/web/tests/billing/savages.spec.ts` | new | — | yes |
| `apps/web/src/marketing/game/SavagesCard.tsx` | new | with the new landing | with the new landing |
| `apps/web/src/marketing/game/EnterTheGame.tsx` | edit | with the new landing | with the new landing |
| `apps/web/src/marketing/game/GameLanding.tsx` | edit | with the new landing | with the new landing |
| `apps/web/preview-game/main.tsx` | edit | never | never (excluded) |

## Appendix B: every new user-visible line

| Where | Text |
|---|---|
| Pro card, both landings | Connect up to 10 accounts |
| AFS card | OR · AI FOR SAVAGES · You learn how to ship products and go viral… that’s what you’re getting from this. · Monthly / Yearly / Lifetime · Save $119.89 · /month /year once · Cancel anytime. / Pay once. Yours for good. · Join AI FOR SAVAGES · Opening Stripe… · Couldn’t open checkout. Try again in a minute. · Secure checkout by Stripe · No refunds, but you can cancel anytime · All sales are final / One payment · All sales are final · POSTERRACT PRO INCLUDED · Connect up to 100 accounts · What you get · the six perks (word for word from aiforsavages.fyi) · Pricing is temporarily unavailable. Try again · Loading current pricing… |
| Stripe page (above the pay button) | Use the email you’ll sign in to Posterract with. No refunds, but you can cancel anytime · All sales are final. (lifetime: …One payment, yours for good · All sales are final.) |
| Accounts page | {used} of {max} accounts · Limit reached · All 10 of your Pro account slots are in use. Disconnect one to add another, or join AI FOR SAVAGES to connect up to 100. · $59.99/mo · $599.99/yr · $2,000 once · All 100 of your account slots are in use. Disconnect an account to add another. · Welcome to AI FOR SAVAGES / Your workspace can now connect up to 100 accounts. · Couldn’t open checkout |
| Connect errors | Account limit reached · Pro connects up to 10 accounts, and all 10 are in use. Disconnect one to add another, or join AI FOR SAVAGES to connect up to 100. · All 100 of your account slots are in use. Disconnect an account to add another. |
| Welcome page | POSTERRACT × AI FOR SAVAGES · One second… / Confirming your payment with Stripe. / Stripe is still confirming your payment. This page updates by itself. · You’re in. / Your monthly membership is active for {email}. · You were already in. · Almost there. · We couldn’t find that checkout. · Step 1 · Your Posterract login · Create your login / Sign in with {email}, the email you paid with… · Step 2 · AI FOR SAVAGES · Open AI FOR SAVAGES · Open Posterract · Sign in to Posterract |
