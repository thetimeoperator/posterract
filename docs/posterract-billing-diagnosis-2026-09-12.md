# Posterract billing diagnosis — September 12, 2026

## Subscriber billing repair — September 13

The remaining subscriber-management and expiration defects are included in the authorized repair. Only historical account/workspace recovery remains excluded by the founder.

- Added Settings → Billing for the current plan, payment-method management, invoices, and cancellation. Workspace owners and admins can select Pro, Allstar, or Superstar with monthly or annual billing and open Stripe's confirmation screen.
- Added Posterract-specific portal configurations. A separate catalog for each selected tier supports Stripe's restriction on multiple prices with the same product/currency/interval; the shared default configuration is preserved. Plan changes require a current, owned, single-item subscription and customer confirmation in Stripe.
- Upgrade invoices select the new positive-price line rather than the old-plan credit. Mid-cycle credit adjustments preserve credits already spent and the existing refill date.
- Added an idempotent repair script. Its production dry run confirmed the missing `checkout.session.expired` subscription and six Stripe-expired sessions still marked open locally. It only reconciles verified checkout statuses and does not recover accounts or change subscriptions.
- Local validation: 21 API/auth/credit tests, 11 browser scenarios, web typecheck, and the production build passed. Billing settings were visually checked at desktop and 390px width; the phone layout has no horizontal overflow.

Production deployment and verification completed on September 13 Pacific time (September 14 UTC):

- Targeted source sync was dry-run, with prior files backed up under `/srv/posterract/backups/billing-management-20260913`. Only API and web were rebuilt and restarted. Both report healthy; local and public API readiness checks pass.
- The repair script created four Posterract-specific portal configurations, subscribed the existing Posterract webhook to `checkout.session.expired`, and reconciled six independently verified expired checkout records. A repeat dry run reports no missing expiration event and zero remaining stale sessions.
- The running API successfully created one live management session and five live plan-change confirmation sessions covering every alternative to the current Pro monthly subscription. Stripe returned the correct confirmation flow for each; subscription price, schedule, and latest invoice were unchanged. No real card charge or subscription update was submitted.
- Public `/settings` serves `index-C0al-Q8t.js`; the public `settings-C8FZng50.js` contains the new management and plan-change controls. The live homepage still renders the requested three-card pricing component and correct $20/$49/$99 prices.
- No caching rule was added, no historical account was recovered, and no Git commit or push was made.

## Repair deployed later on September 12

The founder authorized fixing new signup and rebuilding pricing, and explicitly excluded recovery of stranded accounts. The original investigation below describes the state before that repair.

- Updated signup provisioning to insert a disconnected account only when none exists for that workspace/provider. This preserves the current multi-account schema and avoids the invalid conflict target.
- Extended the real Better Auth signup regression test to apply all 15 current application migrations, verify the owner membership, sign in, and replay provisioning without duplicating placeholders or damaging connected accounts. The updated test reproduced `42P10` before the fix and passed after it.
- Rebuilt and deployed only the API and web services on the VPS. Targeted file syncs were dry-run first; previous source files are saved under `/srv/posterract/backups/billing-repair-20260912`.
- Confirmed the running API's signup hook against the production database in a transaction: application user, owner membership, workspace, and six disconnected placeholders were created successfully, then rolled back. No test data persisted, no verification email was sent, and no existing account was repaired.
- Replaced the single Creator card with three responsive Pro, Allstar, and Superstar cards. Monthly/annual amounts and generation credits load from the billing API. The selected plan and billing interval are preserved in the signup URL and email/Google callback URLs. Checkout defaults to Pro when no explicit choice exists. Billing-gate copy and accessible amount labels now describe the actual selected tier.
- The local alternate landing-page draft uses the same pricing component; that unrelated draft was not published.
- Validation: 21 API/auth/billing checks and 10 browser scenarios pass; web typecheck and local/VPS production builds pass. Desktop, 390px, and 320px pricing layouts were checked. Live public pricing shows $20/$49/$99 monthly and $200/$490/$990 annually, and the Pro annual button opens signup with the correct URL selection.

No real card charge was attempted. At this point subscriber portal management and checkout-expiration reconciliation were still outstanding; the September 13 section records the follow-up repair.

## Original investigation

Read-only production investigation of the VPS stack, running API, PostgreSQL, live Stripe account, and public landing page. No production data, Stripe configuration, subscriptions, or application code was changed. No payment was attempted.

## Confirmed blocker: workspace provisioning fails before checkout

The multi-account migration `010-account-sets.sql` was applied on **August 31, 2026 at 17:43:21 UTC**. It dropped `social_accounts_one_provider_per_workspace_idx`, the unique index on `(workspace_id, provider)`, and replaced it with an index on `(workspace_id, provider, provider_account_id)`.

The signup hook in `apps/api/src/auth.js:156` still inserts placeholder social accounts using `ON CONFLICT (workspace_id, provider) DO NOTHING`. PostgreSQL cannot use that conflict target after the migration and raises:

```text
42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

The hook rolls back the application user, workspace, and membership. Authentication accounts can remain without the application workspace. Later, `apps/api/src/server.js:321` cannot resolve their membership and returns `403 workspace_not_found`. `apps/web/src/billing/BillingGate.tsx:289` renders “Billing check unavailable.” with a retry button instead of the checkout controls. Retrying cannot repair the missing workspace.

Evidence:

- All **54 authentication accounts created since September 1** lack a workspace membership. These are account records, not a verified count of distinct paying customers.
- There are **55 accounts without memberships in total**, including one older account from July; 54 have no linked `app_users` record.
- Retained API logs from September 5–12 contain **11 HTTP 500 email-signup responses** and **151 HTTP 403 billing-subscription responses**. Better Auth logs also show Google/social signup failures with the same SQL error.
- The stack trace points directly to `auth.js:156`.
- A production `EXPLAIN INSERT ... ON CONFLICT (workspace_id, provider)` inside a read-only transaction reproduced SQLSTATE `42P10`. No insert was executed.
- Retained API logs contain no checkout endpoint requests during that period. The last stored successful creation of a checkout session was September 3, for an existing workspace.

This proves a systemic pre-payment blocker. It does not identify the specific customer's session or establish that every incomplete historical checkout had this cause.

## Stripe has three tiers and six valid recurring prices

| Tier | Monthly USD | Annual USD | Monthly generation credits |
| --- | ---: | ---: | ---: |
| Pro | $20 | $200 | 0; bring your own AI keys |
| Allstar | $49 | $490 | 1,200 |
| Superstar | $99 | $990 | 3,000 |

All six prices are active, live-mode, USD recurring prices belonging to the active Posterract Stripe product. Their amounts and billing intervals match the running API's validation. Calling the running billing service's read-only `verifyCatalog()` succeeds.

The original $20/month and $200/year price IDs are reused for Pro. The legacy `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_YEARLY_PRICE_ID` environment variables are empty in the API container; the API falls back to the Pro price IDs. There is no separate fourth legacy price pair on this product.

## Landing page and plan handoff are incomplete

The live homepage still says “One plan” and labels the $20/$200 card “Creator.” This was verified in the browser and matches `apps/web/src/marketing/Homepage.tsx:160` and `apps/web/src/components/ui/animated-pricing-card.tsx:38`.

The pricing button only opens signup. It passes neither a plan nor the selected monthly/annual interval. `BillingGate.tsx:59` resets the interval to monthly, and line 63 defaults the tier to Allstar. Therefore a visitor starting from the $20 Creator card can arrive at a $49 Allstar selection, and a landing-page annual choice is lost. This is a misleading purchase flow even for accounts with valid workspaces; it is separate from the SQL blocker.

## Existing subscriber management is incomplete

The active-subscriber branch of `BillingGate` returns the product immediately. The settings page contains no billing-management controls, and the only portal request in the web source is inside the gate's payment-recovery branch. Active subscribers therefore lack an in-product path to manage billing.

The live default Stripe customer portal allows payment-method changes and cancellation, but `features.subscription_update.enabled` is false. Upgrading or downgrading plans through that portal is disabled. The API also rejects a new checkout when a recognized active subscription already exists, so opening another checkout is not an upgrade flow.

Reference for the portal feature: [Stripe customer portal configuration](https://docs.stripe.com/api/customer_portal/configurations/object).

## Secondary webhook state defect

The Posterract webhook endpoint is enabled, but its subscribed events omit `checkout.session.expired`, although the application implements that handler. Six historical unpaid sessions are expired in Stripe but remain `open` in PostgreSQL. Those customer records have no failed payment intents; the available Stripe data does not establish a bank/card decline for them.

This stale status is an observability/recovery defect, not the demonstrated cause of the new-account workspace failures. [Stripe Checkout lifecycle](https://docs.stripe.com/payments/checkout/how-checkout-works).

## Required repair order

1. Update signup provisioning for the current multi-account schema; do not restore the removed one-account-per-provider restriction. Add a regression check that applies the current migrations before exercising signup.
2. Recover the stranded accounts' application users, owned workspaces, and memberships idempotently, preserving existing records and paid entitlements. Test sign-in through billing status and plan selection for a repaired account and a fresh signup.
3. Show all three tiers on the landing page and preserve plan and interval through signup into checkout.
4. Add active-subscriber billing controls and a deliberate plan-change flow; configure the Posterract portal accordingly. The Stripe account is shared with other products, so changing its shared default portal indiscriminately could affect them.
5. Subscribe to checkout expiration events and reconcile the stale session states.

All inspected production services reported healthy and `/health/ready` passed. Those infrastructure checks do not exercise signup or the billing funnel, so they did not detect this incident. Diagnosis is complete; repairs and deployment remain outstanding.
