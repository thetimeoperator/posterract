import { createFileRoute } from "@tanstack/react-router";
import { Bot, KeyRound, TerminalSquare } from "lucide-react";
import { Panel } from "@posterract/hyperkit";

export const Route = createFileRoute("/_app/uplink")({
  component: Uplink,
});

const CURL_EXAMPLE = `# Schedule a post from any agent, script, or cron job
curl -X POST https://api.posterract.com/v1/posts \\
  -H "Authorization: Bearer prk_••••••••••••" \\
  -F video=@clip.mp4 \\
  -d caption="One artifact. Six projections." \\
  -d platforms="instagram,tiktok,youtube" \\
  -d scheduled_for="2026-06-14T09:00:00Z"`;

/**
 * API — the agent surface. Keys and live endpoints activate with the
 * cloud backend; this page shows exactly what agents will get.
 */
function Uplink() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Panel kicker="For agents & automations" title="Post by API — humans and agents use the same engine" brackets>
        <p className="text-[13px] leading-relaxed text-starlight-dim">
          Everything you can do in this app — upload a video, schedule a post, check its status — will be one
          HTTP call. Your AI agents, cron jobs, and pipelines post through the same scheduler you use here.
        </p>
        <pre className="telemetry mt-4 overflow-x-auto rounded-[10px] border border-[var(--glass-border)] bg-void-1 p-4 text-[11.5px] leading-relaxed text-starlight-dim">
          {CURL_EXAMPLE}
        </pre>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="!p-4">
          <KeyRound size={16} className="text-neon" />
          <p className="mt-2 font-display text-[13px] font-semibold text-starlight">API keys</p>
          <p className="mt-1 text-[12px] text-starlight-faint">Create and revoke workspace keys; every key scoped and auditable.</p>
        </Panel>
        <Panel className="!p-4">
          <TerminalSquare size={16} className="text-neon" />
          <p className="mt-2 font-display text-[13px] font-semibold text-starlight">REST endpoints</p>
          <p className="mt-1 text-[12px] text-starlight-faint">Posts, uploads, accounts, status — plain JSON over HTTPS.</p>
        </Panel>
        <Panel className="!p-4">
          <Bot size={16} className="text-neon" />
          <p className="mt-2 font-display text-[13px] font-semibold text-starlight">Agent tools (MCP)</p>
          <p className="mt-1 text-[12px] text-starlight-faint">Claude and other assistants get native “schedule a post” tools.</p>
        </Panel>
      </div>

      <p className="text-center text-[11px] text-starlight-faint">
        Activates with the cloud backend phase — keys, rate limits, and docs land here.
      </p>
    </div>
  );
}
