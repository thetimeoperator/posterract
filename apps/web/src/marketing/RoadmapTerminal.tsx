import { motion, useReducedMotion } from "framer-motion";

type RoadmapStatus = "queued" | "expanding" | "audit" | "byok" | "classified";

type RoadmapEntry = {
  command: string;
  detail: string;
  status: RoadmapStatus;
  statusLabel: string;
};

const ROADMAP: RoadmapEntry[] = [
  {
    command: "api.pinterest.connect()",
    detail: "Pinterest publishing and scheduling will be added.",
    status: "queued",
    statusLabel: "QUEUED",
  },
  {
    command: "api.reddit.connect()",
    detail: "Reddit community publishing will be added.",
    status: "queued",
    statusLabel: "QUEUED",
  },
  {
    command: "agents.contentFormats.expand()",
    detail: "Different content formats for AI agents will be added.",
    status: "expanding",
    statusLabel: "EXPANDING",
  },
  {
    command: "tiktok.directPost.unlock()",
    detail: "Full TikTok direct posting will be added after platform approval.",
    status: "audit",
    statusLabel: "AUDIT PENDING",
  },
  {
    command: "api.youtube.connect()",
    detail: "YouTube publishing and channel integration will be added.",
    status: "queued",
    statusLabel: "QUEUED",
  },
  {
    command: "api.x.connect({ auth: 'BYOK' })",
    detail: "X API access will use credentials supplied by each user.",
    status: "byok",
    statusLabel: "BYOK",
  },
  {
    command: "release.classified.decrypt()",
    detail: "HUGE SECRET, UNDISCLOSED UPDATE THAT WILL SHAKE THE INDUSTRY.",
    status: "classified",
    statusLabel: "CLASSIFIED",
  },
];

export function RoadmapTerminal() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="site-roadmap" id="roadmap" aria-labelledby="roadmap-title">
      <div className="site-roadmap-heading">
        <div>
          <p className="site-kicker">THE ROADMAP // LIVE BUILD LOG</p>
          <h2 id="roadmap-title">What enters the network next.</h2>
        </div>
        <p>
          The current system is only the first layer. Follow the release queue as
          Posterract expands its publishing network and agent capabilities.
        </p>
      </div>

      <motion.div
        className="site-roadmap-terminal"
        initial={reduceMotion ? false : { opacity: 0, y: 34, scale: 0.985 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.18 }}
        transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="site-roadmap-chrome">
          <div className="site-roadmap-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>posterract://release-channel/main</span>
          <strong><i aria-hidden="true" /> WATCHING</strong>
        </div>

        <div className="site-roadmap-command" aria-hidden="true">
          <span>founder@posterract</span><strong>:</strong><em>~/roadmap</em><strong>$</strong>
          <code> posterract roadmap --watch</code><b className="site-terminal-cursor" />
        </div>

        <ol className="site-roadmap-list">
          {ROADMAP.map((entry, index) => (
            <motion.li
              className={`site-roadmap-entry site-roadmap-${entry.status}`}
              key={entry.command}
              initial={reduceMotion ? false : { opacity: 0, x: -14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.45 }}
              transition={{
                duration: 0.42,
                delay: reduceMotion ? 0 : 0.12 + index * 0.075,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <span className="site-roadmap-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="site-roadmap-branch" aria-hidden="true"><i /></span>
              <div className="site-roadmap-code">
                <code>{entry.command}</code>
                <p>{entry.detail}</p>
              </div>
              <strong>{entry.statusLabel}</strong>
            </motion.li>
          ))}
        </ol>

        <div className="site-roadmap-footer">
          <span>7 updates queued</span>
          <span>branch // future/main</span>
          <span>signal encrypted</span>
        </div>
      </motion.div>
    </section>
  );
}
