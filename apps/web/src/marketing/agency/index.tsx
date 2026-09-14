import { useState, type FormEvent } from "react";
import { MoveRight } from "lucide-react";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { AGENTS } from "./agents";
import { OpsWindow } from "./OpsWindow";

/**
 * The agency offer: "I program content agents that grow your page."
 *
 * Everything the founder has to fill in lives in AGENCY below. Nothing on
 * the page invents a number, a client or a result in its place.
 */
export const AGENCY = {
  /** Where applications go. Already public on the page's footer. */
  inbox: "pahlevansina@gmail.com",
  /** A booking link makes it the primary call to action; without one the form is. */
  bookingUrl: null as string | null,
  /** Prices per shape; null reads "Priced on the call". */
  prices: { setup: null, managed: null, autopilot: null } as Record<Shape, string | null>,
};

export type Shape = "setup" | "managed" | "autopilot";

const HERO_PLATFORMS = ["instagram", "tiktok", "facebook", "threads", "youtube", "x", "linkedin", "reddit"] as const;

const SHAPES: Array<{ id: Shape; name: string; line: string; includes: string[]; featured?: boolean }> = [
  {
    id: "setup",
    name: "Setup",
    line: "I build your five agents on your Posterract account, hand them over, and teach you to run them.",
    includes: ["Strategy call: formats, platforms, cadence", "The five agents programmed for your page", "Two weeks of tuning on real posts", "A handover session and the playbook"],
  },
  {
    id: "managed",
    name: "Managed",
    line: "I run the agents every week. You see the calendar before anything posts.",
    includes: ["Everything in Setup", "Weekly production and scheduling", "You approve the calendar, or single posts", "A weekly review; the agents are retrained on what performed"],
    featured: true,
  },
  {
    id: "autopilot",
    name: "Autopilot",
    line: "The page runs itself. You get the report.",
    includes: ["Everything in Managed", "Approval delegated inside guardrails we set together", "A monthly strategy call", "The analytics, every week, in one page"],
  },
];

const STEPS = [
  { n: "01", title: "Strategy call", text: "We pick the formats, the platforms and the cadence for your page. You bring access and references; I bring the plan.", meta: "45 minutes" },
  { n: "02", title: "I program the agents", text: "Each agent gets your voice, your brand, its guardrails and the approval rule: every post, or none.", meta: "First week" },
  { n: "03", title: "They produce and schedule", text: "The calendar fills. Every post is made on the same editor you can see in product mode, then scheduled to your accounts.", meta: "Every week" },
  { n: "04", title: "We learn", text: "The analytics from what posted flow back to the agents. Hooks that worked get reused; formats that didn't get retired.", meta: "Weekly review" },
];

const FAQ = [
  { q: "Who owns the accounts and the content?", a: "You do. The agents run on your Posterract account and post to your connected pages. Everything made is yours, exported and kept in your project." },
  { q: "Which platforms can they post to today?", a: "Instagram, Facebook and Threads publish directly. TikTok receives drafts in your inbox for you to post. YouTube, X, LinkedIn and Reddit are on the roadmap." },
  { q: "Do I have to approve every post?", a: "Your call. Approve the whole week at once, approve single posts, or delegate approval inside guardrails we set together." },
  { q: "What do you need from me?", a: "Access to the pages, your references (posts you like, people you sound like), product photos or footage if the UGC agent is on the team, and one call." },
  { q: "How fast does it start?", a: "The strategy call is first. The agents are programmed and tuned during the first week, on real posts you see before they go out." },
  { q: "Can I take it over later?", a: "Yes. Setup is exactly that: the agents are built on your account and handed to you with the playbook. Managed and Autopilot can end the same way." },
];

const PLATFORM_OPTIONS = ["Instagram", "TikTok", "Threads", "Facebook", "YouTube", "X", "LinkedIn", "Reddit"];
const BUDGETS = ["Under $1,000 / month", "$1,000 – $3,000 / month", "$3,000 – $10,000 / month", "$10,000+ / month", "Not sure yet"];

function scrollToApply() {
  document.getElementById("apply")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The primary action: the booking link when there is one, otherwise the form. */
export function workWithMe() {
  if (AGENCY.bookingUrl) window.open(AGENCY.bookingUrl, "_blank", "noopener");
  else scrollToApply();
}

export function AgencyHero() {
  return (
    <div className="site-hero-copy site-hero-copy-centered">
      <div className="site-hero-message">
        <p className="site-kicker">WORK WITH ME // CONTENT AGENTS, PROGRAMMED FOR YOUR PAGE</p>
        <h1 id="site-title" aria-label="I program content agents that grow your page">
          <span className="site-hero-title-line">I program content agents</span>
          <span className="site-hero-title-line">that grow your page.</span>
        </h1>

        <p className="site-hero-lede">
          You get a content team that runs on Posterract: five agents I set up for your audience, your formats and your voice.
          They make the videos, schedule them, post them, and learn from what performs. You approve, or you let them run.
        </p>

        <div className="site-hero-platforms" aria-label="Where the agents post">
          {HERO_PLATFORMS.map((id) => (
            <span data-platform={id} key={id}>
              <img src={PLATFORM_MARK_SOURCES[id]} alt={id} />
            </span>
          ))}
        </div>
      </div>

      <div className="site-actions site-actions-centered">
        <button className="site-primary" type="button" onClick={workWithMe}>
          Work with me
          <MoveRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
        <a className="site-secondary" href="#team">See the team</a>
      </div>

      <p className="site-live site-live-centered">
        <span /> One operator. Five agents. Your account, your content.
      </p>
    </div>
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
          <p className="site-kicker">HOW IT RUNS // FOUR STEPS</p>
          <h2 id="how-title">From one call to a page that posts itself.</h2>
        </div>
        <p>The system is the product you can switch to at the top of this page. The service is me running it for you.</p>
      </div>

      <ol className="site-how-rail">
        {STEPS.map((step) => (
          <li className="site-how-step" key={step.n}>
            <span>{step.n}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <small>{step.meta}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Engagement({ onChoose }: { onChoose: (shape: Shape) => void }) {
  return (
    <section className="site-agency-section site-engage" id="engage" aria-labelledby="engage-title">
      <div className="site-platforms-heading">
        <div>
          <p className="site-kicker">WAYS TO WORK // THREE SHAPES</p>
          <h2 id="engage-title">Pick how much of it you want me to run.</h2>
        </div>
        <p>Every shape starts with the same strategy call and the same five agents. They differ in who runs the week.</p>
      </div>

      <div className="site-engage-grid">
        {SHAPES.map((shape) => (
          <article className="site-engage-card" data-featured={shape.featured ?? false} key={shape.id}>
            <span>{shape.featured ? "MOST PAGES" : "SHAPE"}</span>
            <h3>{shape.name}</h3>
            <p>{shape.line}</p>
            <ul>
              {shape.includes.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div className="site-engage-price">
              <span>Price</span>
              <strong>{AGENCY.prices[shape.id] ?? "Priced on the call"}</strong>
            </div>
            <button className={shape.featured ? "site-primary" : "site-secondary"} type="button" onClick={() => onChoose(shape.id)}>
              Start with {shape.name}
              {shape.featured && <MoveRight aria-hidden="true" size={15} strokeWidth={1.8} />}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Apply({ shape, onShape }: { shape: Shape; onShape: (shape: Shape) => void }) {
  const [sent, setSent] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const platforms = data.getAll("platforms").map(String);
    const handle = field("handle");
    const subject = `Work with me — ${handle || field("name")}`;
    const body = [
      `Name: ${field("name")}`,
      `Email: ${field("email")}`,
      `Page: ${handle}`,
      `Platforms: ${platforms.join(", ") || "—"}`,
      `Shape: ${SHAPES.find((entry) => entry.id === field("shape"))?.name ?? shape}`,
      `Budget: ${field("budget")}`,
      "",
      "What the page is for:",
      field("purpose"),
    ].join("\n");
    window.location.href = `mailto:${AGENCY.inbox}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <section className="site-agency-section site-apply" id="apply" aria-labelledby="apply-title">
      <div className="site-platforms-heading">
        <div>
          <p className="site-kicker">APPLY // A SHORT FORM</p>
          <h2 id="apply-title">Tell me about the page.</h2>
        </div>
        <p>Six fields. I read every one and answer with a time for the call.</p>
      </div>

      <div className="site-apply-grid">
        <aside className="site-apply-aside">
          <dl>
            <dt>What I need from you</dt>
            <dd>Access to the pages. Posts you like and people you sound like. Product photos or footage if the UGC agent joins the team.</dd>
            <dt>What you get back</dt>
            <dd>A time for the strategy call, the shape I recommend for your page, and the first week's plan.</dd>
            <dt>Prefer email?</dt>
            <dd><a href={`mailto:${AGENCY.inbox}`}>{AGENCY.inbox}</a></dd>
          </dl>
        </aside>

        <form className="site-apply-form" onSubmit={submit}>
          <div className="site-apply-row">
            <label>Name<input name="name" type="text" autoComplete="name" required /></label>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          </div>
          <div className="site-apply-row">
            <label>Page handle<input name="handle" type="text" placeholder="@yourpage" required /></label>
            <label>
              Shape
              <select name="shape" value={shape} onChange={(event) => onShape(event.target.value as Shape)}>
                {SHAPES.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          </div>
          <div className="site-apply-field">
            <span>Platforms</span>
            <div className="site-apply-chips">
              {PLATFORM_OPTIONS.map((platform) => (
                <label key={platform}><input type="checkbox" name="platforms" value={platform} />{platform}</label>
              ))}
            </div>
          </div>
          <label>What the page is for<textarea name="purpose" rows={4} placeholder="Who it is for, what it sells or builds, where you want it in six months." required /></label>
          <label>
            Monthly budget
            <select name="budget" defaultValue={BUDGETS[1]}>
              {BUDGETS.map((budget) => <option key={budget}>{budget}</option>)}
            </select>
          </label>
          <div className="site-apply-actions">
            <button className="site-primary" type="submit">
              Send the application
              <MoveRight aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <p className="site-apply-note">
              {sent ? <>Your mail app should be open with the application. If it isn't, write to {AGENCY.inbox}.</> : <>Opens in your mail app, addressed to me. No account needed.</>}
            </p>
          </div>
        </form>
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
