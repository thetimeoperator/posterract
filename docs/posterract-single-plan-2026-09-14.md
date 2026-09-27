# Posterract single-plan deployment — 14 September 2026

Posterract now offers only Pro: USD $20/month or $200/year, with customers supplying their own AI provider keys. The editor's existing provider/key UI and project-local storage remain unchanged.

## Deployed behavior

- Public pricing uses one branded card and a monthly/yearly switch. The annual card displays $200/year and the $16.67 monthly equivalent.
- Signup preserves Pro and the selected billing cycle. Links naming retired plans resolve to Pro.
- Checkout and billing-cycle changes reject Allstar and Superstar. Four retired Stripe prices and their two dedicated portal configurations are inactive.
- Stripe management supports payment-method changes, invoices, and cancellation at the paid period's end. Pro cycle changes open a Stripe confirmation flow.
- An active subscription with a failed payment now opens billing recovery instead of another checkout. Access refreshes after returning from Stripe, and the gate offers a payment-status check.
- Closing annual checkout preserves the annual selection.
- Hosted AI error responses direct Pro customers to their own provider keys and no longer advertise unavailable upgrades.
- Historical invoice/subscription price mappings remain recognized.

## Verification

- 23 billing, credit, schema and signup tests passed; 8 AI tests passed.
- All 11 browser scenarios passed across the full run and one retry. The retry addressed the first scenario's five-second local startup timeout.
- Web typecheck, production build, syntax and diff checks passed.
- Lifecycle regression covers scheduled cancellation retaining paid access, resuming renewal, failed renewal/payment recovery, ended-subscription access removal, resubscription, pending-change guards, and active-subscription duplication rejection.
- Actual live Stripe checkout sessions were created for $20 monthly and $200 yearly and immediately expired without payment. Actual management and annual confirmation sessions were created successfully. No financial confirmation was submitted; the existing subscription, invoice, schedule and cancellation state remained unchanged.
- Live Stripe catalog contains exactly two active prices for the Posterract product. Retired purchases and plan changes are rejected. Required checkout, subscription and invoice webhook events are enabled.
- Public browser inspection confirmed exactly one pricing card, both amounts, BYOK copy, and the annual signup URL.

## Deployment

Only the selected billing/pricing sources, operational scripts and tests were synced after a dry run. Local changes from other work were preserved. API and web were rebuilt and restarted through Docker Compose on the VPS; no Git commit/push or Vercel deployment was performed.

Production source: `/srv/posterract/source`. Previous selected source files are backed up at `/srv/posterract/backups/single-plan-20260914/source-before.tar.gz`.

Public entry bundle after deployment: `index-ClAM94w6.js`; application bundle: `_app-CYYCNFjC.js`. Source checksums for all 14 synced files matched the local versions. API/web readiness was healthy following the normal container startup interval.

No customer was charged and no real customer cancellation or renewal was executed. Those transitions were tested with signed webhook fixtures; Stripe portal settings and session creation were checked live.
