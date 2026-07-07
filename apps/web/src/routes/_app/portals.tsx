import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { Button, Panel, PlatformRune, Telemetry, pushSignal } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PLATFORM_ORDER } from "@posterract/contract";
import { useEngineActions, useOAuth, usePortals } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/portals")({
  component: Portals,
});

/**
 * Portals — one card per platform (3×2, echoing the device's six pods).
 * Demo connections toggle instantly; real OAuth replaces the toggle when
 * the cloud backend lands.
 */
function Portals() {
  const portals = usePortals();
  const { setPortalStatus } = useEngineActions();
  const oauth = useOAuth();

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[12.5px] text-starlight-dim">
        Each portal is one connected account. A transmission only projects to platforms whose portal is aligned.
        <span className="text-starlight-faint"> Demo mode: connections toggle instantly — real platform sign-in arrives with the cloud backend.</span>
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PLATFORM_ORDER.map((provider) => {
          const caps = PLATFORM_CAPABILITIES[provider];
          const portal = portals.find((p) => p.provider === provider);
          const status = portal?.status ?? "disconnected";
          const connected = status === "connected";

          return (
            <Panel
              key={provider}
              brackets
              shimmer
              className={clsx("relative transition-shadow", connected && "shadow-glow-auroral-md")}
              style={{
                borderColor: connected
                  ? "rgba(101,255,154,0.35)"
                  : status === "needs_reauth"
                    ? "rgba(255,204,102,0.35)"
                    : "var(--glass-border)",
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border"
                  style={{
                    color: caps.accent,
                    borderColor: connected ? caps.accent : "var(--glass-border)",
                    boxShadow: connected ? `0 0 16px color-mix(in srgb, ${caps.accent} 35%, transparent)` : undefined,
                  }}
                >
                  <PlatformRune platform={provider} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[14px] font-semibold text-starlight">{caps.label}</p>
                  <p className="telemetry text-[11px] text-starlight-faint">
                    {connected ? portal?.handle : status === "needs_reauth" ? "token expired" : "no account linked"}
                  </p>
                </div>
                <span
                  className={clsx(
                    "telemetry flex-none text-[10px]",
                    connected && "text-auroral",
                    status === "needs_reauth" && "text-solar",
                    !connected && status !== "needs_reauth" && "text-starlight-faint",
                  )}
                >
                  {connected ? "● LINKED" : status === "needs_reauth" ? "◐ RE-ALIGN" : "○ CLOSED"}
                </span>
              </div>

              <div className="mt-3">
                <Telemetry
                  rows={[
                    ...(portal?.windowUsage
                      ? [
                          {
                            k: `${portal.windowUsage.windowHours}h window`,
                            v: `${portal.windowUsage.used}/${portal.windowUsage.cap} posts`,
                          },
                        ]
                      : []),
                    ...(connected && portal?.tokenExpiresAt
                      ? [
                          {
                            k: "token",
                            v: `≈ ${Math.max(1, Math.round((portal.tokenExpiresAt - Date.now()) / 86400_000))}d`,
                            tone: "good" as const,
                          },
                        ]
                      : []),
                    ...(caps.feeCentsPerPost ? [{ k: "platform fee", v: `$${(caps.feeCentsPerPost / 100).toFixed(2)}/post`, tone: "warn" as const }] : []),
                  ]}
                />
              </div>

              <p className="mt-2 min-h-8 text-[11px] leading-snug text-starlight-faint">
                {caps.approval.publicRequires ? `Public access requires: ${caps.approval.publicRequires}.` : caps.notes[0]}
              </p>

              <div className="mt-3 flex gap-2">
                {(() => {
                  const real = oauth.supported.has(provider);
                  if (connected) {
                    return (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        onClick={async () => {
                          if (real) await oauth.disconnect(provider);
                          else setPortalStatus(provider, "disconnected");
                          pushSignal({ tone: "info", title: `${caps.label} disconnected` });
                        }}
                      >
                        Disconnect
                      </Button>
                    );
                  }
                  return (
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      onClick={async () => {
                        if (real) {
                          const { url } = await oauth.start(provider);
                          if (url) window.location.href = url;
                          return;
                        }
                        setPortalStatus(provider, "connected");
                        pushSignal({
                          tone: "success",
                          title: `${caps.label} portal opened`,
                          detail: "Demo connection — real sign-in for this platform is coming.",
                        });
                      }}
                    >
                      {status === "needs_reauth" ? "Reconnect" : real ? `Connect ${caps.label}` : "Open portal (demo)"}
                    </Button>
                  );
                })()}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
