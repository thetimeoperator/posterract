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
 * stands out as the upgrade beside Posterract Pro. The button goes straight to
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
      <div className="sv-ring" ref={ringRef} data-live="off">
        <article className="sv-card" aria-labelledby="sv-title">
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
