import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CircleCheck, Laptop, LoaderCircle, ShieldCheck } from "lucide-react";
import { WelcomeAuthCard } from "@/components/ui/welcome-auth-card";
import { authClient, posterractApiUrl } from "@/lib/authClient";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";

type Search = { request?: string };
type RequestDetails = {
  requestId: string;
  deviceName: string;
  platform: string;
  appVersion?: string;
  status: string;
  expiresAt: number;
};

export const Route = createFileRoute("/desktop/authorize")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    request: typeof search.request === "string" ? search.request : undefined,
  }),
  component: DesktopAuthorize,
});

function DesktopAuthorize() {
  const { request } = Route.useSearch();
  const session = authClient.useSession();
  const [details, setDetails] = useState<RequestDetails>();
  const [status, setStatus] = useState<"loading" | "ready" | "approving" | "approved" | "error">("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!posterractApiUrl || !request) {
      setError("This desktop authorization link is incomplete.");
      setStatus("error");
      return;
    }
    const controller = new AbortController();
    void fetch(`${posterractApiUrl}/v1/desktop/auth/request/${encodeURIComponent(request)}`, {
      signal: controller.signal,
      credentials: "include",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => undefined)) as RequestDetails & { error?: string };
        if (!response.ok) throw new Error(payload?.error ?? "Desktop request was not found");
        setDetails(payload);
        setStatus(payload.status === "approved" || payload.status === "consumed" ? "approved" : "ready");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Desktop request could not be loaded");
        setStatus("error");
      });
    return () => controller.abort();
  }, [request]);

  const approve = async () => {
    if (!posterractApiUrl || !request) return;
    setStatus("approving");
    setError(undefined);
    const response = await fetch(`${posterractApiUrl}/v1/desktop/auth/approve`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: request }),
    });
    const payload = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    if (!response.ok) {
      setError(payload?.error?.replaceAll("_", " ") ?? "Desktop approval failed");
      setStatus("error");
      return;
    }
    setStatus("approved");
  };

  const returnPath = `/desktop/authorize?request=${encodeURIComponent(request ?? "")}`;
  if (!session.isPending && !session.data?.user && request) {
    return (
      <main className="welcome-auth-gate">
        <div className="welcome-auth-gate-background" aria-hidden="true"><SpaceBackdrop /></div>
        <div className="welcome-auth-gate-card">
          <WelcomeAuthCard
            onSuccess={() => window.location.reload()}
            successUrl={returnPath}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="chamber relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-5 py-10">
      <SpaceBackdrop />
      <section className="relative z-[var(--z-content)] w-full max-w-[560px] rounded-[26px] border border-white/[0.12] bg-[rgba(4,11,9,.84)] p-8 shadow-[0_35px_120px_rgba(0,0,0,.72)] backdrop-blur-[28px]">
        <p className="font-display text-[14px] font-semibold tracking-[0.16em] text-starlight">POSTER<span className="text-neon">RACT</span></p>
        {status === "approved" ? (
          <div className="py-10 text-center">
            <CircleCheck className="mx-auto text-neon" size={45} strokeWidth={1.4} />
            <h1 className="mt-5 font-display text-[29px] font-semibold text-starlight">Desktop approved.</h1>
            <p className="mt-2 text-[13px] text-starlight-dim">Return to Posterract Desktop. This browser tab can be closed.</p>
          </div>
        ) : status === "loading" || session.isPending ? (
          <div className="flex min-h-[280px] items-center justify-center"><LoaderCircle className="animate-spin text-neon" size={28} /></div>
        ) : (
          <>
            <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.08] text-neon"><Laptop size={23} /></div>
            <h1 className="mt-5 font-display text-[29px] font-semibold tracking-[-0.03em] text-starlight">Approve this desktop?</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-starlight-dim">This gives the Posterract desktop app access to your current workspace. It does not expose your password or provider tokens.</p>
            {details && (
              <div className="mt-6 rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-4">
                <p className="font-display text-[13px] font-semibold text-starlight">{details.deviceName}</p>
                <p className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-starlight-faint">{details.platform}{details.appVersion ? ` · Posterract ${details.appVersion}` : ""}</p>
              </div>
            )}
            {error && <p className="mt-4 text-[11px] text-redshift" role="alert">{error}</p>}
            <button type="button" disabled={status === "approving" || status === "error"} onClick={() => void approve()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-[12px] bg-neon px-5 py-3 font-display text-[13px] font-semibold text-[#031009] disabled:opacity-60">
              {status === "approving" ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
              {status === "approving" ? "Approving…" : "Approve Posterract Desktop"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
