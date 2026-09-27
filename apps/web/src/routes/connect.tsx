import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, LoaderCircle, PlugZap, ShieldCheck } from "lucide-react";
import { WelcomeAuthCard } from "@/components/ui/welcome-auth-card";
import { authClient, posterractApiUrl } from "@/lib/authClient";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";

/**
 * Where an AI assistant's sign-in link lands (Meta Muse and other MCP
 * clients): the user sees which app is asking and what it can do, then allows
 * or denies. The API sends the browser here from /v1/oauth/authorize; see
 * apps/api/src/mcp/auth.js.
 */

type Search = { request?: string };
type RequestDetails = {
  requestId: string;
  appName: string;
  returnsTo: string;
  permissions: { scope: string; label: string }[];
  expiresAt: number;
};

export const Route = createFileRoute("/connect")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    request: typeof search.request === "string" ? search.request : undefined,
  }),
  component: ConnectApp,
});

const PROBLEMS: Record<string, string> = {
  request_expired: "This link has expired. Go back to your assistant and connect Posterract again.",
  subscription_required: "Connecting an assistant needs a Posterract plan.",
  billing_status_unavailable: "We couldn't check your plan just now. Try again in a minute.",
};

function ConnectApp() {
  const { request } = Route.useSearch();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const [details, setDetails] = useState<RequestDetails>();
  const [status, setStatus] = useState<"loading" | "ready" | "deciding" | "leaving" | "error">("loading");
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    if (!posterractApiUrl || !request) {
      setProblem("This link is incomplete. Go back to your assistant and connect Posterract again.");
      setStatus("error");
      return;
    }
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch(`${posterractApiUrl}/v1/oauth/requests/${encodeURIComponent(request)}`, {
      signal: controller.signal,
      credentials: "include",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => undefined)) as RequestDetails & { error?: string };
        if (!response.ok) throw new Error(PROBLEMS[payload?.error ?? ""] ?? "This link couldn't be opened. Try connecting again.");
        setDetails(payload);
        setStatus("ready");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setProblem(cause instanceof Error ? cause.message : "This link couldn't be opened. Try connecting again.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [request, signedIn]);

  const decide = async (approve: boolean) => {
    if (!posterractApiUrl || !request) return;
    setStatus("deciding");
    setProblem(undefined);
    const response = await fetch(`${posterractApiUrl}/v1/oauth/requests/${encodeURIComponent(request)}/decision`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve }),
    }).catch(() => undefined);
    const payload = (await response?.json().catch(() => undefined)) as { redirect?: string; error?: string } | undefined;
    if (!response?.ok || !payload?.redirect) {
      setProblem(PROBLEMS[payload?.error ?? ""] ?? "That didn't go through. Try again.");
      setStatus("error");
      return;
    }
    setStatus("leaving");
    window.location.assign(payload.redirect);
  };

  if (!session.isPending && !signedIn && request) {
    return (
      <main className="welcome-auth-gate">
        <div className="welcome-auth-gate-background" aria-hidden="true"><SpaceBackdrop /></div>
        <div className="welcome-auth-gate-card">
          <WelcomeAuthCard
            onSuccess={() => window.location.reload()}
            successUrl={`/connect?request=${encodeURIComponent(request)}`}
          />
        </div>
      </main>
    );
  }

  const appName = details?.appName ?? "This app";
  return (
    <main className="chamber relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-5 py-10">
      <SpaceBackdrop />
      <section className="relative z-[var(--z-content)] w-full max-w-[560px] rounded-[26px] border border-white/[0.12] bg-[rgba(4,11,9,.84)] p-8 shadow-[0_35px_120px_rgba(0,0,0,.72)] backdrop-blur-[28px]">
        <p className="font-display text-[14px] font-semibold tracking-[0.16em] text-starlight">POSTER<span className="text-neon">RACT</span></p>
        {status === "leaving" ? (
          <div className="py-10 text-center">
            <LoaderCircle className="mx-auto animate-spin text-neon" size={36} />
            <h1 className="mt-5 font-display text-[24px] font-semibold text-starlight">Taking you back to {appName}…</h1>
          </div>
        ) : status === "loading" || session.isPending ? (
          <div className="flex min-h-[280px] items-center justify-center"><LoaderCircle className="animate-spin text-neon" size={28} /></div>
        ) : status === "error" && !details ? (
          <div className="py-8">
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.03em] text-starlight">Couldn't connect</h1>
            <p className="mt-3 text-[13px] leading-relaxed text-starlight-dim" role="alert">{problem}</p>
            {problem === PROBLEMS.subscription_required && (
              <a href="/settings" className="mt-6 inline-flex rounded-[12px] bg-neon px-5 py-3 font-display text-[13px] font-semibold text-[#031009]">See plans</a>
            )}
          </div>
        ) : (
          <>
            <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.08] text-neon"><PlugZap size={23} /></div>
            <h1 className="mt-5 font-display text-[29px] font-semibold tracking-[-0.03em] text-starlight">Connect {appName} to Posterract?</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-starlight-dim">
              It will be able to:
            </p>
            <ul className="mt-4 space-y-2.5 rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-4">
              {details?.permissions.map((permission) => (
                <li key={permission.scope} className="flex items-start gap-2.5 text-[13px] leading-snug text-starlight">
                  <Check className="mt-[1px] shrink-0 text-neon" size={15} strokeWidth={2.4} />
                  {permission.label}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11.5px] leading-relaxed text-starlight-faint">
              It never sees your password or your social logins. You can disconnect it any time in Settings.
              {details?.returnsTo ? ` You'll go back to ${details.returnsTo}.` : ""}
            </p>
            {problem && <p className="mt-4 text-[11px] text-redshift" role="alert">{problem}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" disabled={status === "deciding"} onClick={() => void decide(false)} className="flex-1 rounded-[12px] border border-white/[0.14] px-5 py-3 font-display text-[13px] font-semibold text-starlight disabled:opacity-60">
                Deny
              </button>
              <button type="button" disabled={status === "deciding"} onClick={() => void decide(true)} className="flex flex-[2] items-center justify-center gap-2 rounded-[12px] bg-neon px-5 py-3 font-display text-[13px] font-semibold text-[#031009] disabled:opacity-60">
                {status === "deciding" ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
                Allow
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
