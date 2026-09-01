import { useState } from "react";
import { ExternalLink, LoaderCircle, MonitorUp } from "lucide-react";
import { SpaceBackdrop } from "@/shell/SpaceBackdrop";
import { desktopSignIn, useDesktopAuth } from "@/lib/desktopAuth";

export function DesktopSignIn() {
  const auth = useDesktopAuth();
  const [busy, setBusy] = useState(false);
  const authorizing = busy || auth.status === "authorizing";

  const begin = async () => {
    setBusy(true);
    await desktopSignIn().finally(() => setBusy(false));
  };

  return (
    <main className="chamber relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-5 py-10">
      <SpaceBackdrop />
      <div className="relative z-[var(--z-content)] w-full max-w-[520px] overflow-hidden rounded-[26px] border border-white/[0.12] bg-[rgba(4,11,9,0.82)] p-7 shadow-[0_35px_120px_rgba(0,0,0,.72),0_0_90px_rgba(101,255,154,.09)] backdrop-blur-[28px] sm:p-9">
        <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-neon/[0.10] blur-[85px]" />
        <p className="relative font-display text-[14px] font-semibold tracking-[0.16em] text-starlight">
          POSTER<span className="text-neon">RACT</span>
        </p>
        <div className="relative mt-9 flex h-12 w-12 items-center justify-center rounded-[14px] border border-neon/25 bg-neon/[0.08] text-neon">
          <MonitorUp size={23} strokeWidth={1.6} />
        </div>
        <h1 className="relative mt-5 font-display text-[31px] font-semibold tracking-[-0.035em] text-starlight">
          Connect this desktop.
        </h1>
        <p className="relative mt-2 text-[13px] leading-relaxed text-starlight-dim">
          Sign in through your browser once. Your social connections, schedule, analytics, API keys, and billing stay securely in the Posterract cloud.
        </p>
        <button
          type="button"
          disabled={authorizing}
          onClick={() => void begin()}
          className="relative mt-7 flex w-full items-center justify-center gap-2 rounded-[12px] border border-neon/40 bg-neon px-5 py-3 font-display text-[13px] font-semibold text-[#031009] shadow-[0_0_32px_rgba(101,255,154,.16)] transition hover:bg-[#83ffad] disabled:cursor-wait disabled:opacity-75"
        >
          {authorizing ? <LoaderCircle className="animate-spin" size={17} /> : <ExternalLink size={16} />}
          {authorizing ? "Waiting for browser approval…" : "Sign in with browser"}
        </button>
        {auth.error && (
          <p className="relative mt-3 rounded-[10px] border border-redshift/25 bg-redshift/[0.07] px-3 py-2 text-[11px] text-redshift" role="alert">
            {auth.error.replaceAll("_", " ")}
          </p>
        )}
        <p className="relative mt-5 text-[10.5px] leading-relaxed text-starlight-faint">
          Keep Posterract open while approving this device. Provider passwords and social tokens are never stored on your computer.
        </p>
      </div>
    </main>
  );
}
