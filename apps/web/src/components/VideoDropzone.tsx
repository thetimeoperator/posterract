import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { UploadCloud } from "lucide-react";
import { OrbitRing, pushSignal } from "@posterract/hyperkit";
import type { ArtifactDTO } from "@posterract/contract";
import { useEngineActions, probeVideo } from "@/engine/useEngine";

const ACCEPTED = ["video/mp4", "video/quicktime", "video/webm"];

/**
 * The Containment Field — drag-drop / click-to-browse video intake.
 * Reads metadata, stores the file (IndexedDB), hands back the artifact.
 */
export function VideoDropzone({
  onReady,
  compact,
  className,
}: {
  onReady: (artifact: ArtifactDTO) => void;
  compact?: boolean;
  className?: string;
}) {
  const { addArtifact } = useEngineActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const intake = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!ACCEPTED.includes(file.type)) {
        pushSignal({ tone: "danger", title: "Unsupported format", detail: "Use MP4, MOV, or WebM video." });
        return;
      }
      setProgress(0.12);
      const meta = await probeVideo(file);
      setProgress(0.55);
      const artifact = await addArtifact(file, meta);
      setProgress(1);
      setTimeout(() => {
        setProgress(null);
        onReady(artifact);
      }, 350);
    },
    [addArtifact, onReady],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add a video — drag and drop or browse"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void intake(e.dataTransfer.files?.[0]);
      }}
      className={clsx(
        "relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] border-2 border-dashed transition-all duration-300",
        compact ? "min-h-28 px-4 py-5" : "min-h-72 px-6 py-10",
        dragOver
          ? "border-neon bg-[rgba(101,255,154,0.06)] shadow-glow-neon-md scale-[1.01]"
          : "border-[var(--glass-border-bright)] hover:border-neon/60 hover:bg-[rgba(101,255,154,0.03)]",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(e) => {
          void intake(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {progress !== null ? (
        <>
          <OrbitRing value={progress} size={compact ? 44 : 64} label="Encapsulating video">
            <span className="telemetry text-[10px] text-starlight">{Math.round(progress * 100)}%</span>
          </OrbitRing>
          <p className="kicker">Encapsulating…</p>
        </>
      ) : (
        <>
          <span
            className={clsx(
              "flex items-center justify-center rounded-full border border-[var(--glass-border-bright)] text-neon transition-transform",
              compact ? "h-10 w-10" : "h-14 w-14",
              dragOver && "scale-110",
            )}
          >
            <UploadCloud size={compact ? 18 : 24} />
          </span>
          <div className="text-center">
            <p className="font-display text-[13px] font-semibold text-starlight">
              {dragOver ? "Release to encapsulate" : "Drop your video here"}
            </p>
            <p className="mt-0.5 text-[11.5px] text-starlight-faint">MP4 · MOV · WebM — or click to browse</p>
          </div>
        </>
      )}
    </div>
  );
}
