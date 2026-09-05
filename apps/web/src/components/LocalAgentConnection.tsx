import { FolderOpen } from "lucide-react";
import { Panel } from "@posterract/hyperkit";
import { DesktopDownloads } from "@/components/DesktopDownloads";
import { isPosterractDesktop } from "@/lib/desktop";

const HOW_IT_WORKS = [
  "Posterract adds one entry to your agent's configuration naming a command on this computer.",
  "Your agent runs that command and gets 28 tools for editing that project's code and canvas.",
  "The tools reach the canvas through your project folder. Nothing leaves this computer.",
];

/**
 * Connecting a coding agent happens in the project editor, where there is a
 * project to open it in. This page is about cloud API keys, which are a
 * different product; all that belongs here is a pointer to the right place
 * and, in the browser, the desktop download that makes it possible at all.
 */
export function LocalAgentConnection() {
  const desktop = isPosterractDesktop();

  return (
    <Panel kicker="Coding agents" title="Connect your agent to the canvas" brackets>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="max-w-2xl text-[13px] leading-relaxed text-starlight-dim">
            The keys below let a remote agent publish through the Posterract API. Giving an agent
            hands-on control of a video is separate: it runs entirely on this computer, so it is set
            up from inside a project.
          </p>
          {desktop ? (
            <div className="mt-5 inline-flex items-center gap-2.5 rounded-[12px] border border-neon/25 bg-neon/[0.06] px-4 py-3">
              <FolderOpen size={15} className="shrink-0 text-neon" />
              <p className="text-[12px] text-starlight-dim">
                Open a project, then use the <span className="font-semibold text-starlight">Agent</span>{" "}
                button at the bottom of the editor.
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <DesktopDownloads compact />
            </div>
          )}
        </div>

        <div className="rounded-[15px] border border-white/[0.08] bg-black/15 p-4">
          <p className="kicker !text-[9px]">How it works</p>
          <div className="mt-3 space-y-2.5">
            {HOW_IT_WORKS.map((point, index) => (
              <div key={point} className="flex gap-2.5">
                <span className="mt-px font-mono text-[10px] font-semibold text-neon/70">{index + 1}</span>
                <p className="text-[11px] leading-relaxed text-starlight-faint">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
