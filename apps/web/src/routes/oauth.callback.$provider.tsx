import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { MiniTesseract, pushSignal } from "@posterract/hyperkit";
import { isPlatformId } from "@posterract/contract";
import { useOAuth } from "@/engine/useEngine";

type CallbackSearch = { code?: string; state?: string; error?: string; error_description?: string };

export const Route = createFileRoute("/oauth/callback/$provider")({
  component: OAuthCallback,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
});

/**
 * Where the platform sends the browser after the user authorizes. Exchanges
 * the code server-side (via the oauth.complete action), then returns to
 * Accounts with a result signal.
 */
function OAuthCallback() {
  const { provider } = useParams({ from: "/oauth/callback/$provider" });
  const search = Route.useSearch();
  const navigate = useNavigate();
  const oauth = useOAuth();
  const [message, setMessage] = useState("Completing connection…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const finish = (tone: "success" | "danger", title: string, detail?: string) => {
      pushSignal({ tone, title, detail });
      void navigate({ to: "/portals" });
    };

    if (search.error) {
      finish("danger", "Connection canceled", search.error_description ?? search.error);
      return;
    }
    if (!isPlatformId(provider) || !search.code || !search.state) {
      finish("danger", "Connection failed", "Missing authorization details.");
      return;
    }

    void oauth
      .complete(provider, search.code, search.state)
      .then((res: { ok: boolean; handle?: string; error?: string }) => {
        if (res.ok) {
          setMessage("Connected. Returning…");
          finish("success", "Account connected", res.handle ? `${res.handle} is linked.` : undefined);
        } else {
          finish("danger", "Connection failed", res.error);
        }
      })
      .catch(() => finish("danger", "Connection failed", "Something went wrong completing the connection."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="chamber flex min-h-screen flex-col items-center justify-center gap-4">
      <MiniTesseract size={36} state="transmitting" />
      <p className="kicker" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
