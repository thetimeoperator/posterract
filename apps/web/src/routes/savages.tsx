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
