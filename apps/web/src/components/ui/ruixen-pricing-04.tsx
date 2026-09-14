"use client";

// Single-plan adaptation of the founder's Ruixen Pricing 04 reference.
import { useEffect, useState } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, Command, KeyRound, ShieldCheck } from "lucide-react";
import type { BillingConfigDTO } from "@posterract/contract";
import { Button } from "@/components/ui/button";
import { posterractApiUrl } from "@/lib/authClient";
import { readBillingSelection, type BillingCycle, type BillingSelection } from "@/billing/selection";
import "@/styles/pricing.css";

const priceFormat: Format = { currency: "USD", style: "currency", minimumFractionDigits: 0, maximumFractionDigits: 0, currencyDisplay: "narrowSymbol" };
const features = [
  ["Create", "Full desktop video editor & agent connection"],
  ["Schedule", "A shared calendar for your connected platforms"],
  ["Publish", "Direct publishing & TikTok draft delivery"],
  ["Track", "Publishing history & performance analytics"],
  ["Connect", "Agent API access & your media library"],
];

export default function Pricing_04({ onLaunch }: { onLaunch: (selection: BillingSelection) => void }) {
  const [cycle, setCycle] = useState<BillingCycle>(() => readBillingSelection().interval);
  const [config, setConfig] = useState<BillingConfigDTO | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const reducedMotion = useReducedMotion();
  const annually = cycle === "yearly";
  const price = config?.plans?.[cycle];
  const amount = price?.amount;
  const available = Boolean(price?.priceId) && amount !== undefined && !error;

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch(`${posterractApiUrl || "https://api.posterract.app"}/v1/billing/config`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Pricing unavailable");
        const next = await response.json() as BillingConfigDTO;
        if (!next.configured || !next.plans) throw new Error("Pricing unavailable");
        if (!controller.signal.aborted) setConfig(next);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);

  return <section className="posterract-pricing" id="pricing" aria-labelledby="pricing-title">
    <div className="rp-ambient" aria-hidden="true" />
    <header className="rp-heading">
      <p className="rp-eyebrow"><Command size={14} aria-hidden="true" /> POSTERRACT / ONE PLAN</p>
      <h2 id="pricing-title">Your entire workflow.<br /><span>One simple plan.</span></h2>
      <p className="rp-intro">Create, schedule, and publish with your agent.<br />Bring your own AI keys. Make it yours.</p>
    </header>

    {error && <p className="rp-error" role="status">Pricing is temporarily unavailable. <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></p>}

    <article className="rp-single-card" aria-labelledby="pricing-pro">
      <div className="rp-purchase">
        <div className="rp-plan-name"><span className="rp-plan-icon"><Command size={21} aria-hidden="true" /></span><h3 id="pricing-pro">Posterract Pro</h3></div>
        <p className="rp-plan-caption">The whole workspace. Your creative control.</p>
        <div className="rp-billing" role="group" aria-label="Billing interval">
          <button className="rp-cycle-label" type="button" aria-pressed={!annually} onClick={() => setCycle("monthly")}>Monthly</button>
          <button className="rp-switch" type="button" role="switch" aria-label="Yearly billing" aria-checked={annually} onClick={() => setCycle(annually ? "monthly" : "yearly")}><span aria-hidden="true" /></button>
          <button className="rp-cycle-label" type="button" aria-pressed={annually} onClick={() => setCycle("yearly")}>Yearly</button>
          <span className="rp-saving">Save $40 / year</span>
        </div>
        <div className="rp-price" role="img" aria-label={amount === undefined ? "Pro pricing loading" : `Pro $${amount / 100} per ${annually ? "year" : "month"}`}>
          {amount === undefined ? <span aria-hidden="true">—</span> : <NumberFlow value={amount / 100} suffix={annually ? "/year" : "/month"} format={priceFormat} locales="en-US" animated={!reducedMotion} aria-hidden="true" />}
        </div>
        <p className="rp-payment-note" aria-live="polite">{amount === undefined ? "Loading current pricing…" : annually ? `$${(amount / 1_200).toFixed(2)} per month, billed $${amount / 100} yearly.` : "Billed monthly. Cancel future renewals anytime."}</p>
        <Button size="lg" className="rp-cta" type="button" disabled={!available} onClick={() => onLaunch({ plan: "pro", interval: cycle })}>Get Pro<ArrowUpRight size={18} aria-hidden="true" /></Button>
        <p className="rp-purchase-note"><ShieldCheck size={13} aria-hidden="true" /> Secure checkout with Stripe</p>
      </div>
      <div className="rp-included">
        <p className="rp-section-label">FROM FIRST IDEA TO PUBLISHED POST</p>
        <ul className="rp-features">{features.map(([title, description]) => <li key={title}><Check size={16} aria-hidden="true" /><div><strong>{title}</strong><span>{description}</span></div></li>)}</ul>
        <div className="rp-byok">
          <span className="rp-key-icon"><KeyRound size={19} aria-hidden="true" /></span>
          <div><h4>Your AI. Your API keys.</h4><p>Choose a provider and save your key in the editor. AI usage is billed directly by your provider.</p><div className="rp-providers"><span>Google Gemini</span><span>MiniMax</span><span>Fish Audio</span></div></div>
        </div>
      </div>
    </article>
    <p className="rp-footnote">Same features on both billing cycles. Prices in USD. AI provider usage is separate from your Posterract subscription.</p>
  </section>;
}
