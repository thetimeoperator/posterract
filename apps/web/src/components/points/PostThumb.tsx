import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Film } from "lucide-react";
import type { PostPointsDTO } from "@posterract/contract";
import { artifactUrl } from "@/engine/useEngine";

/**
 * A post's thumbnail: the platform's cover when there is one, otherwise the
 * posted video's first frame (storage keeps the video two days after it goes
 * live). A cover that fails to load falls back the same way. `playing` runs
 * the video muted and looping, for the feed's hover preview and the stat card.
 */
export function PostThumb({
  post,
  playing = false,
  prefer = "still",
  className,
}: {
  post?: Pick<PostPointsDTO, "artifactId" | "thumbnailUrl">;
  playing?: boolean;
  /** "video": play the posted video while storage still has it (the stat card); else the cover. */
  prefer?: "still" | "video";
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [stillFailed, setStillFailed] = useState(false);
  const stored = artifactUrl(post?.artifactId);
  const still = stillFailed || (prefer === "video" && stored) ? undefined : post?.thumbnailUrl;
  const video = still ? undefined : stored;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (playing) {
      void element.play().catch(() => {});
    } else {
      element.pause();
      element.currentTime = 0.1;
    }
  }, [playing, video]);

  if (still) {
    return (
      <img
        className={clsx("post-thumb", className)}
        src={still}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setStillFailed(true)}
      />
    );
  }
  if (video) {
    return <video ref={ref} className={clsx("post-thumb", className)} src={`${video}#t=0.1`} muted loop playsInline preload="metadata" />;
  }
  return (
    <span className={clsx("post-thumb post-thumb--empty", className)}>
      <Film size={18} strokeWidth={1.6} />
    </span>
  );
}
