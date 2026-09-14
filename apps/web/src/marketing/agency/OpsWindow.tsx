import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { AGENTS } from "./agents";

/**
 * The ops window: the service, shown running.
 *
 * Left, a terminal where the operator's commands run — the five agents are
 * hired for the page, the week is run, the analytics are read. Right, the
 * page's week board fills with posts as the terminal schedules them. It is an
 * example week, labeled as one; the thumbnails are real clips made with the
 * five skills.
 */

type StepKind = "cmd" | "ok" | "run" | "note";
type Step = { kind: StepKind; text: string; agent?: string };

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const BOARD_PLATFORMS = [
  { id: "instagram", name: "Instagram" },
  { id: "tiktok", name: "TikTok" },
  { id: "threads", name: "Threads" },
  { id: "facebook", name: "Facebook" },
] as const;

type Post = { agent: string; day: number; platform: string; time: string };

/** The example week: twelve posts, one cell each. */
const POSTS: Post[] = [
  { agent: "clip", day: 1, platform: "instagram", time: "09:00" },
  { agent: "clip", day: 3, platform: "tiktok", time: "12:00" },
  { agent: "clip", day: 5, platform: "threads", time: "18:00" },
  { agent: "lead", day: 0, platform: "tiktok", time: "11:00" },
  { agent: "lead", day: 4, platform: "instagram", time: "09:00" },
  { agent: "talk", day: 2, platform: "instagram", time: "17:00" },
  { agent: "talk", day: 6, platform: "facebook", time: "10:00" },
  { agent: "news", day: 0, platform: "threads", time: "08:00" },
  { agent: "news", day: 2, platform: "facebook", time: "08:00" },
  { agent: "news", day: 4, platform: "threads", time: "08:00" },
  { agent: "ugc", day: 1, platform: "tiktok", time: "19:00" },
  { agent: "ugc", day: 5, platform: "instagram", time: "12:00" },
];

const schedule = (agent: string) =>
  POSTS.filter((post) => post.agent === agent)
    .sort((a, b) => a.day - b.day)
    .map((post) => `${DAYS[post.day]} ${post.time}`)
    .join(" · ");

const SCRIPT: Step[] = [
  { kind: "cmd", text: "posterract agents hire --for @yourpage" },
  ...AGENTS.map((agent): Step => ({ kind: "ok", text: `${agent.n} ${agent.name} — ${agent.line}` })),
  { kind: "cmd", text: "posterract agents run --week" },
  ...AGENTS.map((agent): Step => ({ kind: "run", agent: agent.id, text: `${agent.n} ${agent.name} · ${POSTS.filter((p) => p.agent === agent.id).length} made` })),
  { kind: "ok", text: `${POSTS.length} posts scheduled · Instagram · TikTok · Threads · Facebook` },
  { kind: "cmd", text: "posterract analytics --learn" },
  { kind: "ok", text: "best hook this week: 02 Lead With Animations · reused by 01 and 04" },
  { kind: "note", text: "next week's calendar rebuilt around it" },
];

const TYPE_MS = 34; // per character
const START_MS = 700;
const HOLD_MS = 4600;
const RESTART_MS = 500;

/** When each step begins and ends, so playback is a function of time and never falls behind a throttled tab. */
const TIMELINE = (() => {
  let at = START_MS;
  return SCRIPT.map((step) => {
    const start = at;
    const length = step.kind === "cmd" ? step.text.length * TYPE_MS + 460 : step.kind === "run" ? 560 : step.kind === "note" ? 260 : 320;
    at += length;
    return { start, end: at };
  });
})();
const CYCLE_MS = TIMELINE[TIMELINE.length - 1]!.end + HOLD_MS + RESTART_MS;

/** How much of the script has begun at `t` ms into the cycle: the steps begun, and the characters typed of the last one. */
function progressAt(t: number): { index: number; chars: number } {
  let index = 0;
  while (index < SCRIPT.length && TIMELINE[index]!.start <= t) index += 1;
  if (index === 0) return { index: 0, chars: 0 };
  const step = SCRIPT[index - 1]!;
  const chars = step.kind === "cmd" ? Math.min(step.text.length, Math.floor((t - TIMELINE[index - 1]!.start) / TYPE_MS)) : 0;
  return { index, chars };
}

function Prompt({ text, typing }: { text: string; typing: boolean }) {
  return (
    <div className="site-ops-cmd">
      <span>founder@posterract</span><strong>:</strong><em>~/pages/yourpage</em><strong>$</strong>
      <code>{text}</code>
      {typing && <b className="site-terminal-cursor" />}
    </div>
  );
}

export function OpsWindow() {
  const reduceMotion = useReducedMotion();
  const [progress, setProgress] = useState({ index: 0, chars: 0 });

  useEffect(() => {
    if (reduceMotion) {
      setProgress({ index: SCRIPT.length, chars: 0 });
      return;
    }
    const began = performance.now();
    let shown = { index: -1, chars: -1 };
    let timer = 0;
    const tick = () => {
      const t = (performance.now() - began) % CYCLE_MS;
      const next = t >= TIMELINE[TIMELINE.length - 1]!.end ? { index: SCRIPT.length, chars: 0 } : progressAt(t);
      if (next.index !== shown.index || next.chars !== shown.chars) {
        shown = next;
        setProgress(next);
      }
      timer = window.setTimeout(tick, 40);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  /** Which agents have run so far, so the board fills in step with the terminal. */
  const ran = useMemo(() => {
    const ids = new Set<string>();
    SCRIPT.slice(0, progress.index).forEach((step) => {
      if (step.kind === "run" && step.agent) ids.add(step.agent);
    });
    return ids;
  }, [progress.index]);
  const visiblePosts = POSTS.filter((post) => ran.has(post.agent));
  const finished = progress.index >= SCRIPT.length;

  return (
    <div className="site-roadmap-terminal site-ops" aria-label="An example week run by the agents">
      <div className="site-roadmap-chrome">
        <div className="site-roadmap-lights" aria-hidden="true"><i /><i /><i /></div>
        <span>posterract://pages/yourpage/ops</span>
        <strong><i aria-hidden="true" /> {finished ? "WEEK SET" : "ON SHIFT"}</strong>
      </div>

      <div className="site-ops-body">
        <div className="site-ops-terminal" aria-hidden="true">
          {SCRIPT.slice(0, progress.index).map((step, index) => {
            const typing = index === progress.index - 1 && !finished;
            if (step.kind === "cmd") {
              return <Prompt key={index} text={typing ? step.text.slice(0, progress.chars) : step.text} typing={typing} />;
            }
            return (
              <div className={`site-ops-line site-ops-${step.kind}`} key={index}>
                <i>{step.kind === "ok" ? "✓" : step.kind === "run" ? "→" : "·"}</i>
                <span>{step.text}</span>
                {step.kind === "run" && step.agent && <em>{schedule(step.agent)}</em>}
              </div>
            );
          })}
          {finished && <Prompt text="" typing />}
        </div>

        <div className="site-ops-board">
          <div className="site-ops-board-head">
            <span>Example week · <b>@yourpage</b></span>
            <span><b>{visiblePosts.length}</b> / {POSTS.length} posts</span>
          </div>
          <div className="site-ops-grid" role="table" aria-label="The week's posts by day and platform">
            <span />
            {DAYS.map((day) => <span className="site-ops-day" key={day}>{day}</span>)}
            {BOARD_PLATFORMS.map((platform) => (
              <>
                <span className="site-ops-platform" data-platform={platform.id} key={platform.id}>
                  <img src={PLATFORM_MARK_SOURCES[platform.id]} alt="" /> {platform.name}
                </span>
                {DAYS.map((day, dayIndex) => {
                  const post = visiblePosts.find((entry) => entry.platform === platform.id && entry.day === dayIndex);
                  const agent = post ? AGENTS.find((entry) => entry.id === post.agent) : null;
                  return (
                    <span className="site-ops-cell" key={`${platform.id}-${day}`}>
                      {post && agent && (
                        <figure className="site-ops-card">
                          <img src={agent.poster} alt="" />
                          <figcaption><b>{agent.n}</b><small>{post.time}</small></figcaption>
                        </figure>
                      )}
                    </span>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      <div className="site-roadmap-footer">
        <span>five agents on the page</span>
        <span>{finished ? "calendar set · learning on" : "scheduling"}</span>
        <span>you approve, or you don't have to</span>
      </div>
    </div>
  );
}
