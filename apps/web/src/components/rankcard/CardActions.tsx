import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Film, ImageDown, Send } from "lucide-react";
import { pushSignal } from "@posterract/hyperkit";
import { POINTS_PLATFORMS, type LeaderboardDTO, type PlatformId } from "@posterract/contract";
import { probeVideo, useEngineActions, usePortals } from "@/engine/useEngine";
import { useAuthState } from "@/lib/useAuthState";
import { useProfile } from "@/state/profile";
import { cardFileName, cardImage, cardVideo, saveFile } from "./shareCard";
import type { CardAssets } from "./drawCard";
import type { CardModel, Player } from "./cardModel";

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Cards post to the platforms that allow an app's branding on a post; TikTok's rules don't. */
const CARD_PLATFORMS: PlatformId[] = ["instagram", "facebook", "threads"];
const HANDLE_ORDER: PlatformId[] = ["instagram", "threads", "tiktok"];

/** The connected accounts that play: the platforms that earn points. */
export function usePlayingAccounts() {
  const portals = usePortals();
  return portals.filter(
    (portal) => portal.status === "connected" && (POINTS_PLATFORMS as readonly string[]).includes(portal.provider),
  );
}

/** Who a card belongs to: the name the leaderboard shows (never an email) and an account handle. */
export function usePlayer(board: LeaderboardDTO | undefined): Player {
  const auth = useAuthState();
  const profile = useProfile();
  const accounts = usePlayingAccounts();
  const accountKey = accounts.map((portal) => portal.id).join();
  return useMemo(() => {
    const candidates = [board?.me?.name, auth.user?.name, profile.displayName];
    const name =
      candidates.find((value) => value && !EMAIL.test(value) && value !== "Posterract creator") ??
      candidates.find((value) => value && !EMAIL.test(value)) ??
      "Posterract creator";
    const account = HANDLE_ORDER.map((provider) => accounts.find((portal) => portal.provider === provider && portal.handle)).find(Boolean);
    const handle = account?.handle ? (account.handle.startsWith("@") ? account.handle : `@${account.handle}`) : undefined;
    return { name, handle };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.me?.name, auth.user?.name, profile.displayName, accountKey]);
}

type Busy = { kind: "post" | "video" | "image"; label: string; progress?: number };

/**
 * Post, and the two saves, for one card. Post makes the card's Reel in the
 * browser, uploads it and opens a new post with it, the caption written and
 * Instagram, Facebook and Threads picked.
 */
export function CardActions({ model, assets }: { model: CardModel; assets?: CardAssets }) {
  const navigate = useNavigate();
  const { addArtifact } = useEngineActions();
  const accounts = usePlayingAccounts();
  const [busy, setBusy] = useState<Busy>();

  const fail = (title: string, error: unknown) => {
    setBusy(undefined);
    pushSignal({ tone: "danger", title, detail: error instanceof Error ? error.message : "Something went wrong. Try again." });
  };

  const post = async () => {
    if (!assets || busy) return;
    try {
      setBusy({ kind: "post", label: "Making the video", progress: 0 });
      const blob = await cardVideo(model, assets, (fraction) => setBusy({ kind: "post", label: "Making the video", progress: fraction * 0.55 }));
      const file = new File([blob], cardFileName(model, "mp4"), { type: "video/mp4" });
      const meta = await probeVideo(file);
      setBusy({ kind: "post", label: "Uploading", progress: 0.55 });
      const artifact = await addArtifact(file, meta, (fraction) => setBusy({ kind: "post", label: "Uploading", progress: 0.55 + fraction * 0.45 }));
      window.sessionStorage.setItem("posterract.forgeDraft", model.caption);
      const targets = CARD_PLATFORMS.filter((provider) => accounts.some((portal) => portal.provider === provider));
      setBusy(undefined);
      void navigate({ to: "/compose", search: { artifact: artifact.id, platforms: (targets.length ? targets : ["instagram"]).join(",") } });
    } catch (error) {
      fail("Couldn't make the card's post", error);
    }
  };

  const saveVideo = async () => {
    if (!assets || busy) return;
    try {
      setBusy({ kind: "video", label: "Making the video", progress: 0 });
      const blob = await cardVideo(model, assets, (fraction) => setBusy({ kind: "video", label: "Making the video", progress: fraction }));
      saveFile(blob, cardFileName(model, "mp4"));
      setBusy(undefined);
    } catch (error) {
      fail("Couldn't make the card's video", error);
    }
  };

  const saveImage = async () => {
    if (!assets || busy) return;
    try {
      setBusy({ kind: "image", label: "Saving" });
      saveFile(await cardImage(model, assets), cardFileName(model, "png"));
      setBusy(undefined);
    } catch (error) {
      fail("Couldn't save the card", error);
    }
  };

  return (
    <div className="card-actions">
      <button type="button" className="card-actions__post" onClick={() => void post()} disabled={!assets || Boolean(busy)} aria-busy={busy?.kind === "post"}>
        <Send size={15} strokeWidth={2.2} />
        {busy?.kind === "post" ? `${busy.label} ${Math.round((busy.progress ?? 0) * 100)}%` : "Post card"}
        {busy?.kind === "post" && <span className="card-actions__bar" style={{ width: `${(busy.progress ?? 0) * 100}%` }} aria-hidden />}
      </button>
      <div className="card-actions__saves">
        <button type="button" onClick={() => void saveVideo()} disabled={!assets || Boolean(busy)}>
          <Film size={14} strokeWidth={2} />
          {busy?.kind === "video" ? `Video ${Math.round((busy.progress ?? 0) * 100)}%` : "Save video"}
        </button>
        <button type="button" onClick={() => void saveImage()} disabled={!assets || Boolean(busy)}>
          <ImageDown size={14} strokeWidth={2} />
          {busy?.kind === "image" ? "Saving…" : "Save image"}
        </button>
      </div>
      <p className="card-actions__note">Opens a new post with the card's video on Instagram, Facebook and Threads.</p>
    </div>
  );
}
