import { useState } from "react";
import { readBillingSelection, type BillingCycle, type BillingSelection } from "@/billing/selection";
import { usePlanPrices, type PlanPrices } from "./prices";
import type { SavagesPlans } from "@/lib/savages";
import { SavagesCard } from "./SavagesCard";

/** Posterract Pro, priced live from billing, with its three lines, and beside it the upgrade: AI FOR SAVAGES (SavagesCard). */

const FEATURES = [
  ["Full Figma-Style Video Editor", "Collab with your agent on an infinite canvas-style video editor"],
  ["Social Media Scheduler", "10 connected accounts max"],
  ["Post with your agent", "Create an API key and give it to your agent to post for you"],
] as const;

export function EnterTheGame({
  onStart,
  prices: given,
  savagesPlans,
}: {
  onStart: (selection: BillingSelection) => void;
  prices?: PlanPrices;
  savagesPlans?: SavagesPlans;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(() => readBillingSelection().interval);
  const { prices, failed, retry } = usePlanPrices(given);
  const yearly = cycle === "yearly";
  const amount = prices ? (yearly ? prices.yearly : prices.monthly) : undefined;
  const saving = prices ? prices.monthly * 12 - prices.yearly : undefined;

  return (
    <section className="g-section g-wrap" id="enter" aria-labelledby="g-enter-title">
      <header className="g-head">
        <div>
          <p className="g-kicker">Enter the game</p>
          <h2 id="g-enter-title">
            Two Ways In (pause).
            <br />
            Full Access.
          </h2>
        </div>
        <p>A gamified social media scheduler for AI agents</p>
      </header>
      <div className="g-plans">
        <article className="g-panel g-plan" aria-labelledby="g-plan-name">
          <div className="g-plan-buy">
            <h3 className="g-plan-name" id="g-plan-name">
              Posterract Pro
            </h3>
            <p className="g-plan-caption">The whole workspace. Your creative control.</p>
            <p className="g-plan-limit">
              <strong>10</strong>
              <span>
                Accounts max
                <small>Connected across every platform</small>
              </span>
            </p>
            <div className="g-cycle">
              <div className="g-seg" role="group" aria-label="Billing interval">
                <button type="button" aria-pressed={!yearly} onClick={() => setCycle("monthly")}>
                  Monthly
                </button>
                <button type="button" aria-pressed={yearly} onClick={() => setCycle("yearly")}>
                  Yearly
                </button>
              </div>
              {saving !== undefined && saving > 0 && <span className="g-saving">Save ${saving / 100} / year</span>}
            </div>
            <p
              className="g-price"
              aria-live="polite"
              aria-label={amount === undefined ? undefined : `Pro $${amount / 100} per ${yearly ? "year" : "month"}`}
            >
              {amount === undefined ? "—" : `$${amount / 100}`}
              <small>{yearly ? "/year" : "/month"}</small>
            </p>
            <p className="g-price-note">
              {failed ? (
                <>
                  Pricing is temporarily unavailable.{" "}
                  <button type="button" onClick={retry}>
                    Try again
                  </button>
                </>
              ) : amount === undefined ? (
                "Loading current pricing…"
              ) : yearly ? (
                `$${(amount / 1_200).toFixed(2)} per month, billed $${amount / 100} yearly.`
              ) : (
                "Billed monthly. Cancel future renewals anytime."
              )}
            </p>
            {/* No checkout before the price is known (as on the earlier page). */}
            <button
              className="g-btn g-btn-plate g-btn-lg"
              type="button"
              disabled={amount === undefined}
              onClick={() => onStart({ plan: "pro", interval: cycle })}
            >
              Start playing <span aria-hidden="true">→</span>
            </button>
            <p className="g-secure">Secure checkout with Stripe</p>
          </div>
          <div className="g-plan-get">
            <p className="g-label">This is what you get:</p>
            <ul className="g-features">
              {FEATURES.map(([title, description]) => (
                <li key={title}>
                  <div>
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="g-byok">
              <h3>Your AI. Your API keys.</h3>
              <p>Choose a provider and save your key in the editor. AI usage is billed directly by your provider.</p>
              <div className="g-providers">
                <span>Google Gemini</span>
                <span>MiniMax</span>
                <span>Fish Audio</span>
              </div>
            </div>
            <p className="g-footnote">Same features on both billing cycles. Prices in USD. AI provider usage is separate from your Posterract subscription.</p>
          </div>
        </article>
        <SavagesCard plans={savagesPlans} />
      </div>
    </section>
  );
}
