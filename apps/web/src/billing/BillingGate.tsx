import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import type {
  BillingCheckoutDTO,
  BillingConfigDTO,
  BillingSubscriptionDTO,
} from "@posterract/contract";
import { DesktopHandoff } from "@/billing/DesktopHandoff";
import { authClient, posterractApiUrl } from "@/lib/authClient";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";
import { cloudJson } from "@/lib/cloudRequest";
import { desktopSignOut } from "@/lib/desktopAuth";
import { isPosterractDesktop, openExternalUrl } from "@/lib/desktop";
import { useAuthState } from "@/lib/useAuthState";

type BillingCycle = "monthly" | "yearly";
type PlanId = "pro" | "allstar" | "superstar";

/**
 * What each tier is for, in the buyer's terms. The allowances come from the
 * API so they can never drift from what the ledger actually grants; only the
 * pitch lives here.
 */
const TIERS: ReadonlyArray<{ id: PlanId; name: string; pitch: string }> = [
  { id: "pro", name: "Pro", pitch: "The editor, the agent bridge, and scheduling. Bring your own AI keys." },
  { id: "allstar", name: "Allstar", pitch: "Everything in Pro, plus generation on our models." },
  { id: "superstar", name: "Superstar", pitch: "More of everything, and the only tier with 2K video." },
];
type GateStatus = "checking" | "ready" | "error";

const MANAGEABLE_STATUSES = new Set(["past_due", "unpaid", "paused", "trialing"]);

async function billingRequest<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!posterractApiUrl) throw new Error("Billing is unavailable in this environment.");
  return cloudJson<T>(posterractApiUrl, path, {
    ...init,
    signal,
    cache: "no-store",
  });
}

function price(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

export function BillingGate({ children }: { children: ReactNode }) {
  const authState = useAuthState();
  const [status, setStatus] = useState<GateStatus>("checking");
  const [config, setConfig] = useState<BillingConfigDTO | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscriptionDTO | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState<"checkout" | "portal" | "signout" | null>(null);
  // Allstar is the tier most people want: it is the cheapest one that
  // generates, which is what the product is for.
  const [planId, setPlanId] = useState<PlanId>("allstar");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const returnState = useMemo(
    () => new URLSearchParams(window.location.search).get("billing"),
    [],
  );
  // Payment buys the editor, and the editor is a desktop app: the download is
  // put in front of a new subscriber rather than left to be discovered.
  const [handoffOpen, setHandoffOpen] = useState(
    () => new URLSearchParams(window.location.search).get("welcome") === "desktop",
  );
  const closeHandoff = () => {
    setHandoffOpen(false);
    window.history.replaceState({}, "", window.location.pathname);
  };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;

    const wait = () =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, 1_000);
      });

    const check = async () => {
      setStatus("checking");
      setError(null);
      try {
        const nextConfig = await billingRequest<BillingConfigDTO>(
          "/v1/billing/config",
          {},
          controller.signal,
        );
        if (!nextConfig.configured || !nextConfig.plans) {
          throw new Error("Secure checkout is not configured yet.");
        }
        if (!active) return;
        setConfig(nextConfig);

        const attempts = returnState === "success" ? 25 : 1;
        let nextSubscription: BillingSubscriptionDTO | null = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          nextSubscription = await billingRequest<BillingSubscriptionDTO>(
            "/v1/billing/subscription",
            {},
            controller.signal,
          );
          if (!active) return;
          if (nextSubscription.entitled) {
            setSubscription(nextSubscription);
            setStatus("ready");
            if (returnState === "success") window.location.replace("/?welcome=desktop");
            return;
          }
          if (attempt < attempts - 1) await wait();
        }

        setSubscription(nextSubscription);
        if (returnState === "success") {
          setError("Stripe is still confirming the payment. Check again in a moment.");
        }
        setStatus("ready");
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Billing could not be checked.");
        setStatus("error");
      }
    };

    void check();
    return () => {
      active = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [retry, returnState]);

  useEffect(() => {
    if (!subscription?.entitled) return;
    const controller = new AbortController();
    const revalidate = () => {
      void billingRequest<BillingSubscriptionDTO>(
        "/v1/billing/subscription",
        {},
        controller.signal,
      )
        .then((nextSubscription) => setSubscription(nextSubscription))
        .catch(() => undefined);
    };
    const interval = window.setInterval(revalidate, 60_000);
    window.addEventListener("focus", revalidate);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", revalidate);
    };
  }, [subscription?.entitled]);

  if (status === "ready" && subscription?.entitled) {
    return (
      <>
        {children}
        <DesktopHandoff open={handoffOpen} onClose={closeHandoff} />
      </>
    );
  }

  const plans = config?.plans;
  const creditPlans = config?.creditPlans;
  const tier = creditPlans?.[planId];
  // Labelling the monthly amount "/year" advertised a tenth of what the card is
  // charged. Each interval now shows the amount Stripe actually holds for it, and
  // a yearly price the API could not read is not rendered or sold at all.
  const selectedPlan = tier
    ? cycle === "yearly"
      ? tier.yearlyAmount !== undefined
        ? { amount: tier.yearlyAmount, interval: "year" as const }
        : undefined
      : { amount: tier.amount, interval: "month" as const }
    : plans?.[cycle];
  const needsPortal = MANAGEABLE_STATUSES.has(subscription?.status ?? "");
  const cancelled = returnState === "cancelled";
  const userEmail = authState.user?.email;

  const beginCheckout = async () => {
    setBusy("checkout");
    setError(null);
    try {
      const checkout = await billingRequest<BillingCheckoutDTO>("/v1/billing/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": `checkout-${crypto.randomUUID()}` },
        body: JSON.stringify({ plan: planId, interval: cycle }),
      });
      await openExternalUrl(checkout.url);
      setBusy(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stripe Checkout could not be opened.");
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setError(null);
    try {
      const portal = await billingRequest<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        headers: { "Idempotency-Key": `portal-${crypto.randomUUID()}` },
        body: JSON.stringify({}),
      });
      await openExternalUrl(portal.url);
      setBusy(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stripe billing could not be opened.");
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("signout");
    if (isPosterractDesktop()) await desktopSignOut().catch(() => undefined);
    else await authClient.signOut().catch(() => undefined);
    window.location.assign("/");
  };

  return (
    <div className="chamber relative min-h-screen overflow-hidden bg-void">
      <SpaceBackdrop />
      <div className="pointer-events-none fixed inset-0 z-[calc(var(--z-overlay)-1)] overflow-hidden" aria-hidden>
        <div className="absolute -left-[12rem] top-[8%] h-[34rem] w-[34rem] rounded-full bg-neon/[0.11] blur-[120px]" />
        <div className="absolute -right-[10rem] bottom-[-8rem] h-[38rem] w-[38rem] rounded-full bg-ice/[0.09] blur-[135px]" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 42%, rgba(124,247,255,.10), transparent 34%), linear-gradient(rgba(124,247,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(101,255,154,.03) 1px, transparent 1px)",
            backgroundSize: "auto, 76px 76px, 76px 76px",
            maskImage: "radial-gradient(circle at center, black, transparent 72%)",
          }}
        />
      </div>
      <div className="fixed inset-0 z-[var(--z-overlay)] flex min-h-screen items-center justify-center overflow-y-auto bg-[rgba(1,4,7,0.58)] px-4 py-8 backdrop-blur-[20px]">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="billing-gate-title"
          className="relative w-full max-w-[920px] overflow-hidden rounded-[30px] border border-white/[0.13] bg-[rgba(5,11,14,0.78)] shadow-[0_40px_130px_rgba(0,0,0,0.72),0_0_80px_rgba(101,255,154,0.08)] backdrop-blur-[34px]"
        >
          <div className="pointer-events-none absolute -right-28 -top-36 h-80 w-80 rounded-full bg-ice/[0.11] blur-[90px]" aria-hidden />
          <div className="pointer-events-none absolute -bottom-44 -left-20 h-80 w-80 rounded-full bg-neon/[0.09] blur-[100px]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/[0.035]" aria-hidden />
          <div className="relative flex items-center justify-between border-b border-white/[0.07] px-6 py-5 sm:px-9">
            <p className="font-display text-[15px] font-semibold tracking-[0.16em] text-starlight">
              POSTER<span className="text-neon">RACT</span>
            </p>
            <div className="flex min-w-0 items-center gap-3">
              {userEmail && <p className="hidden max-w-[240px] truncate text-[9.5px] text-starlight-faint sm:block">{userEmail}</p>}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void signOut()}
                className="text-[10px] text-starlight-faint transition-colors hover:text-starlight"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="relative px-6 py-7 sm:px-9 sm:py-9">
            {status === "checking" ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center" aria-live="polite">
                <div className="flex items-center gap-2" aria-hidden>
                  <span className="h-1.5 w-8 animate-pulse rounded-full bg-neon shadow-glow-neon-sm" />
                  <span className="h-1.5 w-3 animate-pulse rounded-full bg-ice [animation-delay:160ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/55 [animation-delay:320ms]" />
                </div>
                <h1 id="billing-gate-title" className="mt-6 font-display text-[25px] font-semibold tracking-[-0.025em] text-starlight">
                  {returnState === "success" ? "Confirming your payment…" : "Checking your access…"}
                </h1>
                {returnState === "success" && (
                  <p className="mt-2 text-[11px] text-starlight-dim">This normally takes a few seconds.</p>
                )}
              </div>
            ) : status === "error" ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center" aria-live="polite">
                <h1 id="billing-gate-title" className="font-display text-[25px] font-semibold text-starlight">
                  Billing check unavailable.
                </h1>
                <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-starlight-dim">{error}</p>
                <button
                  type="button"
                  onClick={() => setRetry((value) => value + 1)}
                  className="mt-5 rounded-[11px] border border-neon/35 bg-neon/[0.08] px-5 py-2.5 font-display text-[12px] font-semibold text-neon transition-colors hover:bg-neon/[0.13]"
                >
                  Check again
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-7 md:grid-cols-[1.12fr_0.88fr] md:gap-8">
                  <div className="py-1">
                    <p className="text-[9px] font-semibold tracking-[0.18em] text-neon">POSTERRACT PRO</p>
                    <h1 id="billing-gate-title" className="mt-2 max-w-md font-display text-[clamp(29px,4vw,39px)] font-semibold leading-[1.04] tracking-[-0.04em] text-starlight">
                      Everything currently shipping, in one plan.
                    </h1>
                    <p className="mt-3 max-w-md text-[11.5px] leading-relaxed text-starlight-dim">
                      Schedule, publish, analyze, and automate from the same workspace. No feature tiers or setup fee.
                    </p>

                    <div className="mt-6 border-t border-white/[0.07] pt-5">
                      <p className="mb-3 text-[9px] font-semibold tracking-[0.13em] text-starlight-faint">INCLUDED</p>
                      <ul className="grid gap-x-5 gap-y-2.5 text-[10.5px] leading-snug text-starlight-dim sm:grid-cols-2">
                        {[
                          "Instagram, Facebook & Threads direct publishing",
                          "TikTok draft delivery",
                          "Drag-and-drop scheduling calendar",
                          "Private video storage & media library",
                          "Authorized performance analytics",
                          "Scoped API keys for agent workflows",
                        ].map((feature) => (
                          <li key={feature} className="flex items-start gap-2">
                            <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-neon shadow-glow-neon-sm" aria-hidden />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[22px] border border-white/[0.11] bg-[rgba(1,7,9,0.64)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_22px_55px_rgba(0,0,0,0.32)] sm:p-6">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-ice/[0.10] blur-[58px]" aria-hidden />
                  <div className="pointer-events-none absolute -bottom-20 -left-14 h-44 w-44 rounded-full bg-neon/[0.10] blur-[64px]" aria-hidden />
                  <div className="relative flex min-h-[340px] flex-col">
                    {!needsPortal ? (
                      <>
                        <p className="font-display text-[15px] font-semibold text-starlight">Choose your plan</p>
                        {creditPlans && (
                          <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label="Plan">
                            {TIERS.filter((entry) => creditPlans[entry.id]).map((entry) => {
                              const plan = creditPlans[entry.id]!;
                              const selected = planId === entry.id;
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  onClick={() => setPlanId(entry.id)}
                                  className={clsx(
                                    "rounded-[11px] border px-3 py-2.5 text-left transition-colors",
                                    selected
                                      ? "border-neon/45 bg-neon/[0.08]"
                                      : "border-white/[0.08] bg-black/20 hover:border-white/[0.16]",
                                  )}
                                >
                                  <span className="flex items-baseline justify-between gap-2">
                                    <span className={clsx("font-display text-[12px] font-semibold", selected ? "text-neon" : "text-starlight")}>
                                      {entry.name}
                                    </span>
                                    <span className="text-[10px] tabular-nums text-starlight-faint">
                                      {price(plan.amount)}/mo
                                    </span>
                                  </span>
                                  <span className="mt-0.5 block text-[9.5px] leading-relaxed text-starlight-faint">
                                    {entry.pitch}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <p className="mt-5 font-display text-[15px] font-semibold text-starlight">Billing</p>
                        {plans && (
                          <div className="mt-4 grid grid-cols-2 rounded-[12px] border border-white/[0.08] bg-black/20 p-1" role="radiogroup" aria-label="Billing cycle">
                            {(["monthly", "yearly"] as const).map((option) => {
                              const plan = plans[option];
                              const selected = cycle === option;
                              const label = option === "monthly" ? "Monthly" : "Yearly";
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  role="radio"
                                  aria-label={`${label} ${price(plan.amount)} per ${plan.interval}`}
                                  aria-checked={selected}
                                  onClick={() => setCycle(option)}
                                  className={clsx(
                                    "rounded-[9px] px-2 py-2.5 text-[10px] font-medium transition-colors",
                                    selected ? "bg-neon/[0.12] text-neon" : "text-starlight-faint hover:text-starlight",
                                  )}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {selectedPlan ? (
                          <>
                            <p className="mt-6 font-display text-[clamp(43px,6vw,58px)] font-semibold leading-none tracking-[-0.055em] text-starlight">
                              {price(selectedPlan.amount)}
                              <small className="ml-1 text-[11px] font-normal tracking-normal text-starlight-faint">/{selectedPlan.interval}</small>
                            </p>
                            <p className="mt-2 text-[10px] text-starlight-dim">
                              {cycle === "yearly" ? "Billed yearly. Credits still refill every month." : "Billed monthly. Switch or cancel anytime."}
                            </p>
                          </>
                        ) : (
                          <p className="mt-6 text-[11px] leading-relaxed text-starlight-dim">
                            Yearly pricing for this plan is unavailable right now. Choose monthly, or
                            try again in a few minutes.
                          </p>
                        )}
                        <div className="mt-5 grid grid-cols-2 gap-2 border-y border-white/[0.07] py-3 text-[9px] text-starlight-faint">
                          <span>No setup fee</span>
                          <span className="text-right">Cancel anytime</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="font-display text-[20px] font-semibold text-starlight">Restore your subscription</p>
                        <p className="mt-2 text-[10.5px] leading-relaxed text-starlight-dim">Update the payment method attached to your Posterract workspace.</p>
                      </>
                    )}

                    <div className="mt-auto pt-6">
                      {(cancelled || error) && (
                        <p className="mb-3 rounded-[10px] border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2.5 text-[10px] text-amber-100" role="status">
                          {error ?? "Checkout was closed before payment."}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null || (!needsPortal && !selectedPlan)}
                        onClick={() => void (needsPortal ? openPortal() : beginCheckout())}
                        className="flex h-12 w-full items-center justify-center rounded-[13px] border border-neon bg-neon px-4 font-display text-[13px] font-bold !text-[#020704] shadow-[0_0_28px_rgba(101,255,154,0.26)] transition-[filter,transform] hover:brightness-110 active:scale-[0.995] disabled:cursor-wait disabled:opacity-60"
                        style={{ color: "#020704" }}
                      >
                        {busy ? "Opening Stripe…" : needsPortal ? "Open Stripe billing" : "Continue to Stripe"}
                      </button>
                      <p className="mt-3 text-center text-[9px] leading-relaxed text-starlight-faint">
                        Review and confirm on Stripe before you are charged.
                      </p>
                    </div>
                  </div>
                </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4 text-[9px] text-starlight-faint">
                  <p>Stripe processes payment. Posterract never stores your card details.</p>
                  <div className="flex items-center gap-4">
                    <a href="/privacy" className="transition-colors hover:text-starlight">Privacy</a>
                    <a href="/terms" className="transition-colors hover:text-starlight">Terms</a>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
