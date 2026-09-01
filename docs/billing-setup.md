# Stripe billing setup — AI credit plans

Posterract's AI credit plans are three monthly Stripe subscriptions. A paid
invoice sets the workspace plan and resets its credit balance to the plan
allotment (no rollover at launch). Cancel or downgrade clears the plan; the
remaining balance survives until the cycle ends.

| Plan    | Price     | Credits per cycle |
| ------- | --------- | ----------------- |
| Creator | $20 / mo  | 150               |
| Studio  | $50 / mo  | 2,250             |
| Agency  | $100 / mo | 5,250             |

## Stripe dashboard steps (live mode)

1. Create three products: `Posterract Creator`, `Posterract Studio`,
   `Posterract Agency`.
2. On each product create one recurring price — USD, monthly, licensed:
   - Creator: **$20.00 / month**
   - Studio: **$50.00 / month**
   - Agency: **$100.00 / month**
3. Copy each `price_...` id into the API and orchestrator environment:

   ```sh
   STRIPE_PRICE_CREATOR=price_...
   STRIPE_PRICE_STUDIO=price_...
   STRIPE_PRICE_AGENCY=price_...
   ```

4. The existing webhook endpoint (`/v1/webhooks/stripe`) already receives the
   required events (`customer.subscription.*`, `invoice.paid`,
   `invoice.payment_failed`); no new webhook configuration is needed.

## How grants flow

- `invoice.paid` for a credit-plan price → workspace plan set, balance reset
  to the allotment, ledger `grant` entry naming the cycle (any unused
  remainder is written as an `expire` entry).
- `customer.subscription.deleted` (or any inactive status) → plan cleared,
  balance untouched until cycle end.
- Subscriptions on these prices count as recognized plans for the product
  entitlement gate, exactly like the legacy monthly/yearly price ids.

`GET /v1/billing/config` exposes the configured plans under `creditPlans` so
clients can render the catalog without hardcoding price ids.

## AI provider environment

The generation endpoints read these variables (all optional — when a key is
missing, or `POSTERRACT_AI_MOCK=1`, that provider returns a deterministic
mock so the feature works with zero keys):

```sh
GEMINI_API_KEY=...        # Nano Banana 2 images (Gemini API)
MINIMAX_API_KEY=...       # Hailuo 3 video
FISH_AUDIO_API_KEY=...    # Fish Audio s2-pro voice
TRANSCRIBE_API_URL=...    # Whisper-class /audio/transcriptions endpoint
TRANSCRIBE_API_KEY=...
POSTERRACT_AI_MOCK=1      # optional: force mock mode everywhere
```

Model ids live in `apps/api/src/ai/constants.js` — verify them against each
provider console when the production keys are created.
