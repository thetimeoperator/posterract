import { useRef } from "react";
import clsx from "clsx";
import { Film } from "lucide-react";
import { artifactUrl } from "@/engine/useEngine";

/**
 * Video thumbnail — renders the artifact's first frame via a muted
 * <video> element; hover scrubs a short loop preview.
 */
export function ArtifactThumb({
  artifactId,
  className,
  hoverPreview = true,
}: {
  artifactId?: string;
  className?: string;
  hoverPreview?: boolean;
}) {
  const url = artifactUrl(artifactId);
  const ref = useRef<HTMLVideoElement>(null);

  if (!url) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center rounded-[10px] border border-[var(--glass-border)] bg-void-2 text-starlight-faint",
          className,
        )}
        aria-hidden
      >
        <Film size={16} />
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      className={clsx("rounded-[10px] border border-[var(--glass-border)] object-cover", className)}
      onMouseEnter={() => {
        if (hoverPreview) void ref.current?.play().catch(() => {});
      }}
      onMouseLeave={() => {
        if (hoverPreview && ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0.1;
        }
      }}
    />
  );
}
