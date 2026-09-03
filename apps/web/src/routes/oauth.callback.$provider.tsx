import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { Button, MiniTesseract, Panel, pushSignal } from "@posterract/hyperkit";
import { isPlatformId } from "@posterract/contract";
import { useOAuth } from "@/engine/useEngine";

type CallbackSearch = { code?: string; state?: string; error?: string; error_description?: string };
type FacebookPageChoice = { id: string; name: string };
type OAuthReturnTarget = "desktop" | "web";

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
  const [pages, setPages] = useState<FacebookPageChoice[]>([]);
  const [selectingPageId, setSelectingPageId] = useState<string>();
  const [returnToDesktop, setReturnToDesktop] = useState(false);
  const ran = useRef(false);

  const openDesktop = (status: "success" | "error" = "success") => {
    window.location.assign(
      `posterract://oauth-complete?provider=${encodeURIComponent(provider)}&status=${status}`,
    );
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const finish = (
      tone: "success" | "danger",
      title: string,
      detail?: string,
      returnTo: OAuthReturnTarget = "web",
    ) => {
      setMessage(detail ? `${title}: ${detail}` : title);
      if (returnTo === "desktop") {
        setReturnToDesktop(true);
        if (tone === "success") window.setTimeout(() => openDesktop("success"), 250);
        return;
      }
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
      .then((res: {
        ok: boolean;
        handle?: string;
        error?: string;
        returnTo?: OAuthReturnTarget;
        selectionRequired?: boolean;
        pages?: FacebookPageChoice[];
      }) => {
        if (res.ok && res.selectionRequired && res.pages?.length) {
          setPages(res.pages);
          setMessage("Choose the Facebook Page Posterract may use");
          return;
        }
        if (res.ok) {
          setMessage("Connected. Returning…");
          finish(
            "success",
            "Account connected",
            res.handle ? `${res.handle} is linked.` : undefined,
            res.returnTo,
          );
        } else {
          finish("danger", "Connection failed", res.error, res.returnTo);
        }
      })
      .catch(() => finish("danger", "Connection failed", "Something went wrong completing the connection."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPage = async (page: FacebookPageChoice) => {
    if (!search.state || selectingPageId) return;
    setSelectingPageId(page.id);
    setMessage(`Connecting ${page.name}…`);
    try {
      const result = await oauth.selectFacebookPage(search.state, page.id);
      if (!result.ok) {
        setSelectingPageId(undefined);
        setMessage(result.error ?? "Page connection failed");
        pushSignal({
          tone: "danger",
          title: "Facebook Page connection failed",
          detail: result.error,
        });
        return;
      }
      pushSignal({
        tone: "success",
        title: "Facebook Page connected",
        detail: `${page.name} is linked.`,
      });
      const returnTarget = "returnTo" in result ? result.returnTo : undefined;
      if (returnTarget === "desktop") {
        setMessage(`${page.name} is connected. Returning to Posterract…`);
        setReturnToDesktop(true);
        window.setTimeout(() => openDesktop("success"), 250);
        return;
      }
      await navigate({ to: "/portals" });
    } catch {
      setSelectingPageId(undefined);
      setMessage("Page connection failed — connect Facebook again.");
    }
  };

  return (
    <main className="chamber flex min-h-screen flex-col items-center justify-center gap-4 px-5">
      <MiniTesseract size={36} state="transmitting" />
      <p className="kicker" aria-live="polite">
        {message}
      </p>
      {pages.length > 0 && (
        <Panel
          kicker="Facebook Page"
          title="Select only the Page you want Posterract to manage"
          brackets
          className="w-full max-w-lg"
        >
          <div className="space-y-2">
            {pages.map((page) => (
              <Button
                key={page.id}
                variant="secondary"
                className="w-full justify-between"
                disabled={Boolean(selectingPageId)}
                onClick={() => void selectPage(page)}
              >
                <span>{page.name}</span>
                <span className="telemetry text-[10px] text-starlight-faint">
                  {selectingPageId === page.id ? "CONNECTING" : "SELECT"}
                </span>
              </Button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-starlight-faint">
            Posterract stores access for the selected Page only. It does not publish to your personal profile.
          </p>
        </Panel>
      )}
      {returnToDesktop && (
        <Button variant="secondary" onClick={() => openDesktop("success")}>
          Open Posterract
        </Button>
      )}
    </main>
  );
}
