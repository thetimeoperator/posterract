import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Starfield } from "@posterract/hyperkit";

const SPACE_WEBM = "/media/posterract-space.webm";
const SPACE_MP4 = "/media/posterract-space.mp4";
const SPACE_POSTER = "/media/posterract-space-poster.webp";

export function SpaceBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const [mediaAvailable, setMediaAvailable] = useState(true);
  const saveData = typeof navigator !== "undefined" && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const showVideo = !reducedMotion && !saveData && mediaAvailable;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showVideo) return;
    const onVisibility = () => {
      if (document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [showVideo]);

  useEffect(() => {
    if (!showVideo) return;
    const onMove = (event: PointerEvent) => {
      const x = ((event.clientX / window.innerWidth) - 0.5) * 6;
      const y = ((event.clientY / window.innerHeight) - 0.5) * 6;
      document.documentElement.style.setProperty("--space-x", `${x}px`);
      document.documentElement.style.setProperty("--space-y", `${y}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [showVideo]);

  return (
    <div className="space-backdrop" aria-hidden>
      <div className="space-backdrop__poster" style={{ backgroundImage: `url(${SPACE_POSTER})` }} />
      {showVideo && (
        <video
          ref={videoRef}
          className="space-backdrop__video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={SPACE_POSTER}
          onError={() => setMediaAvailable(false)}
        >
          <source src={SPACE_WEBM} type="video/webm" />
          <source src={SPACE_MP4} type="video/mp4" />
        </video>
      )}
      <div className="space-backdrop__nebula" />
      <div className="space-backdrop__stars">
        <Starfield />
      </div>
      <div className="space-backdrop__grid chamber-grid" />
      <div className="space-backdrop__grade" />
      <div className="space-backdrop__noise" />
    </div>
  );
}
