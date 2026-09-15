import { useState, type FormEvent, type ReactNode } from "react";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { Button3D } from "@/components/ui/button-3d";
import { SqueezeCarousel, type SqueezeSlide } from "@/components/ui/carousel-squeeze";
import { AGENTS } from "./agents";
import { OpsWindow } from "./OpsWindow";

/**
 * The agency offer: "I program content agents that grow your page."
 *
 * Everything the founder has to fill in lives in AGENCY below. Nothing on
 * the page invents a number, a client or a result in its place.
 */
export const AGENCY = {
  /** Where the form's messages go when the API cannot take them. Already public on the page's footer. */
  inbox: "pahlevansina@gmail.com",
  /** A booking link makes it the primary call to action; without one the form is. */
  bookingUrl: null as string | null,
};

/** One set of accounts: the eight platforms. */
const ACCOUNT_SET: Array<keyof typeof PLATFORM_MARK_SOURCES> = ["instagram", "tiktok", "facebook", "youtube", "threads", "x", "linkedin", "reddit"];

/** The two ways to work, exactly as offered: $5,000 shows its set of accounts as logos, Operation Turbo has its line. */
const OPTIONS = [
  { price: "$5,000", line: "to manage one set of accounts", logos: true },
  { price: "$12,000+", line: "Operation Turbo: scaling multiple accounts at once", tag: "MULTIPLE SETS OF ACCOUNTS SCALED AT ONCE" },
];

const DESCRIPTION_LIMIT = 1000;

/** The API the form posts to: same origin in production (`/api`), none in the local Convex setup. */
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

/** A placeholder photo from Unsplash (free licence), served from its image CDN at the panel's 16:9 block, until generated images replace it. */
const unsplash = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1280&h=720&q=80`;

/** How it works: a step-by-step list as the squeeze carousel's panels, "Step N" as each title and the step itself under it. */
const STEPS: SqueezeSlide[] = [
  {
    id: "call",
    title: "Step 1",
    description: "You fill out the form then we hop on a call. You tell me about your business and what you charge.",
    overlay: <span className="site-how-mark">01</span>,
    image: unsplash("photo-1616587226960-4a03badbe8bf"),
    imageAlt: "A man on a video call at his laptop",
  },
  {
    id: "plan",
    title: "Step 2",
    description: "You send the invoice for the month and I put together a plan.",
    overlay: <span className="site-how-mark">02</span>,
    image: unsplash("photo-1454165804606-c3d57bc86b40"),
    imageAlt: "Hands writing a plan on paper beside two laptops",
  },
  {
    id: "post",
    title: "Step 3",
    description: "I start posting across all platforms and execute the plan.",
    overlay: <span className="site-how-mark">03</span>,
    image: unsplash("photo-1690883793939-f8cca2f28ee0"),
    imageAlt: "A hand holding a phone open to its social media apps",
  },
  {
    id: "results",
    title: "Step 4",
    description: "I check results and analytics daily and feed them to my Agent. Content improves BY THE DAY. New angles every 24 hours until we see results.",
    overlay: <span className="site-how-mark">04</span>,
    image: unsplash("photo-1551288049-bebda4e38f71"),
    imageAlt: "Analytics charts on a dark dashboard",
  },
  {
    id: "brand",
    title: "Step 5",
    description: "We build a LONG-LASTING, SUSTAINABLE brand with high quality content that you OWN forever.",
    overlay: <span className="site-how-mark">05</span>,
    image: unsplash("photo-1625690303837-654c9666d2d0"),
    imageAlt: "A silhouette filming with a cinema camera in blue and red light",
  },
];

const FAQ = [
  { q: "Who owns the accounts and the content?", a: "You do. The agents run on your Posterract account and post to your connected pages. Everything made is yours, exported and kept in your project." },
  { q: "Which platforms can they post to today?", a: "Instagram, Facebook and Threads publish directly. TikTok receives drafts in your inbox for you to post. YouTube, X, LinkedIn and Reddit are on the roadmap." },
  { q: "Do I have to approve every post?", a: "Your call. Approve the whole week at once, approve single posts, or delegate approval inside guardrails we set together." },
  { q: "What do you need from me?", a: "Access to the pages, your references (posts you like, people you sound like), product photos or footage if the UGC agent is on the team, and one call." },
  { q: "How fast does it start?", a: "The strategy call is first. The agents are programmed and tuned during the first week, on real posts you see before they go out." },
  { q: "Can I take it over later?", a: "Yes. The agents are built on your account, and they are handed to you with the playbook whenever you want to run them yourself." },
];


function scrollToApply() {
  document.getElementById("apply")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The primary action: the booking link when there is one, otherwise the form. */
export function workWithMe() {
  if (AGENCY.bookingUrl) window.open(AGENCY.bookingUrl, "_blank", "noopener");
  else scrollToApply();
}

export function AgencyHero({ fork }: { fork: ReactNode }) {
  return (
    <>
      <div className="site-stage-head">
        <div className="site-stage-copy">
          <div className="site-stage-lever">{fork}</div>
          <h1 id="site-title" aria-label="I program content agents that grow your page">
            <span className="site-hero-title-line">I program content agents</span>
            <span className="site-hero-title-line">that grow your page.</span>
          </h1>
          <p className="site-kicker site-stage-kicker">WORK WITH ME // CONTENT AGENTS, PROGRAMMED FOR YOUR PAGE</p>
          <p className="site-hero-lede site-stage-lede">
            You pay and tell me how your business makes money. I create a variety of content formats and start posting. When one produces results, I scale. You focus on your business.
          </p>
        </div>
      </div>
      <div className="site-work-stage" id="apply">
        <WorkForm />
      </div>
    </>
  );
}

type SendState = "idle" | "sending" | "sent" | "mailed";

/**
 * The brief: one large panel in the lever's material. "Fill out the form
 * below" in the accent over "Two Options:", the two prices (per month) as
 * choosable tiles ($5,000 with its row of platform logos, Operation Turbo with
 * its line), then name, email and a description of up to 1000 characters,
 * then the 3D Send. It posts to
 * the API, which mails the founder with the sender as reply-to; if the API
 * cannot take it, the mail app opens with the same message, addressed to him.
 */
export function WorkForm() {
  const [state, setState] = useState<SendState>("idle");
  const [count, setCount] = useState(0);
  const [option, setOption] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const message = {
      name: field("name"),
      email: field("email"),
      description: field("description").slice(0, DESCRIPTION_LIMIT),
      ...(option ? { option } : {}),
    };
    setState("sending");
    try {
      const response = await fetch(`${API_BASE}/v1/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error(`contact ${response.status}`);
      setSentTo(message.email);
      setState("sent");
    } catch {
      const body = [`Name: ${message.name}`, `Email: ${message.email}`, ...(option ? [`Option: ${option}`] : []), "", message.description].join("\n");
      window.location.href = `mailto:${AGENCY.inbox}?subject=${encodeURIComponent(`Work with me: ${message.name}`)}&body=${encodeURIComponent(body)}`;
      setState("mailed");
    }
  };

  if (state === "sent") {
    return (
      <div className="site-brief site-brief-done" role="status">
        <p className="site-brief-sent">Sent.</p>
        <p className="site-brief-sent-line">I'll answer at {sentTo}.</p>
      </div>
    );
  }

  return (
    <form className="site-brief" onSubmit={submit} aria-labelledby="brief-title">
      <div className="site-brief-head">
        <p className="site-brief-cue">Fill out the form below</p>
        <h2 className="site-brief-title" id="brief-title">Two Options:</h2>
      </div>

      <div className="site-brief-options" role="radiogroup" aria-label="Two options">
        {OPTIONS.map((entry) => {
          const value = `${entry.price} per month ${entry.line}`;
          const selected = option === value;
          return (
            <label className="site-brief-option" data-selected={selected} key={entry.price}>
              <input type="radio" name="option" value={value} checked={selected} onChange={() => setOption(value)} />
              <span className="site-brief-led" aria-hidden="true" />
              <span className="site-brief-price">{entry.price} <span className="site-brief-per">per month</span></span>
              <span className="site-brief-line">{entry.line}</span>
              {entry.logos && (
                <span className="site-brief-sets" aria-hidden="true">
                  <span className="site-brief-set">
                    {ACCOUNT_SET.map((platform) => (
                      <img src={PLATFORM_MARK_SOURCES[platform]} alt="" data-platform={platform} key={platform} />
                    ))}
                  </span>
                </span>
              )}
              {entry.tag && <span className="site-brief-tag">{entry.tag}</span>}
            </label>
          );
        })}
      </div>

      <div className="site-brief-fields">
        <div className="site-brief-row">
          <label className="site-brief-field">
            <span>Name</span>
            <input name="name" type="text" autoComplete="name" maxLength={120} required />
          </label>
          <label className="site-brief-field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
        </div>
        <label className="site-brief-field">
          <span>Description</span>
          <textarea name="description" rows={7} maxLength={DESCRIPTION_LIMIT} required onChange={(event) => setCount(event.target.value.length)} />
          <span className="site-brief-count" aria-live="polite">{count} / {DESCRIPTION_LIMIT}</span>
        </label>
      </div>

      <div className="site-brief-actions">
        <Button3D label={state === "sending" ? "Sending" : "Send"} type="submit" disabled={state === "sending"} />
        {state === "mailed" && <p className="site-brief-note">Your mail app opened with the message. If it didn't, write to {AGENCY.inbox}.</p>}
      </div>
    </form>
  );
}

export function AgencyOps() {
  return (
    <div className="site-hero-ops">
      <OpsWindow />
    </div>
  );
}

export function Team() {
  return (
    <section className="site-agency-section site-team" id="team" aria-labelledby="team-title">
      <div className="site-platforms-heading">
        <div>
          <p className="site-kicker">THE TEAM // FIVE AGENTS</p>
          <h2 id="team-title">Five agents. Each does one job.</h2>
        </div>
        <p>These are the skills that ship with Posterract. I set each one up for your page: what it makes, what it sounds like, what it is allowed to do.</p>
      </div>

      <div className="site-team-grid">
        {AGENTS.map((agent) => (
          <article className="site-team-card" key={agent.id}>
            <header>
              <span className="site-team-index">AGENT {agent.n}</span>
              <h3>{agent.name}</h3>
            </header>
            <video src={agent.src} poster={agent.poster} muted loop autoPlay playsInline preload="metadata" aria-label={`A clip made by the ${agent.name} agent`} />
            <p>{agent.makes}</p>
            <dl className="site-team-sets">
              <dt>What I set</dt>
              <dd>{agent.sets}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HowItRuns() {
  return (
    <section className="site-agency-section site-how" id="how" aria-labelledby="how-title">
      <div className="site-platforms-heading">
        <div>
          <p className="site-kicker">the steps we go through</p>
          <h2 id="how-title">How This Process Works</h2>
        </div>
        <p>The system is the product you can switch to at the top of this page. The service is me running it for you.</p>
      </div>

      <div className="site-how-squeeze">
        <SqueezeCarousel slides={STEPS} label="How it works" accent="var(--site-green)" accentForeground="#021016" style={{ fontFamily: "var(--font-display)" }} />
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section className="site-agency-section site-faq" id="faq" aria-labelledby="faq-title">
      <div className="site-platforms-heading">
        <div>
          <p className="site-kicker">QUESTIONS // STRAIGHT ANSWERS</p>
          <h2 id="faq-title">Before the call.</h2>
        </div>
      </div>
      <div className="site-faq-list">
        {FAQ.map((entry) => (
          <details key={entry.q}>
            <summary>{entry.q}</summary>
            <p>{entry.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function AgencyFinalCta({ onProduct }: { onProduct: () => void }) {
  return (
    <section className="site-final-cta" aria-labelledby="final-title">
      <p className="site-kicker">YOUR PAGE, RUN BY AGENTS</p>
      <h2 id="final-title">Stop making content.<br />Start approving it.</h2>
      <button type="button" onClick={workWithMe}>Work with me</button>
      <button className="site-final-alt" type="button" onClick={onProduct}>Or use the product yourself →</button>
    </section>
  );
}
