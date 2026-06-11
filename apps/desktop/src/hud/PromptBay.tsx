import { Mic, Paperclip, Play } from "lucide-react";
import { motion } from "framer-motion";
import { useId, useRef } from "react";
import { FileDropZone } from "./FileDropZone";
import type { AttachedFile, VidtryxPhase } from "../state/types";

type PromptBayProps = {
  prompt: string;
  files: AttachedFile[];
  phase: VidtryxPhase;
  onPromptChange: (prompt: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onGenerate: () => void;
};

export function PromptBay({
  prompt,
  files,
  phase,
  onPromptChange,
  onAddFiles,
  onRemoveFile,
  onGenerate,
}: PromptBayProps) {
  const running = phase === "running";
  const canGenerate = (prompt.trim().length > 0 || files.length > 0) && !running;
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    if (running) return;
    fileInputRef.current?.focus();
    fileInputRef.current?.click();
  };

  return (
    <motion.section
      className="prompt-bay hud-panel"
      initial={{ y: 42, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <div className="prompt-input-wrap">
        <button
          className="icon-button icon-button--prototype"
          type="button"
          aria-label="Voice input prototype disabled"
          title="Voice prototype disabled"
          disabled
        >
          <Mic size={18} />
        </button>
        <textarea
          data-testid="prompt-input"
          value={prompt}
          disabled={running}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Give Vidtryx the video idea..."
          rows={2}
        />
        <button
          className="icon-button"
          type="button"
          aria-label="Attach assets"
          aria-controls={fileInputId}
          disabled={running}
          onClick={openFilePicker}
        >
          <Paperclip size={18} />
        </button>
        <button
          data-testid="generate-button"
          className="generate-button"
          type="button"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          <Play size={18} />
          <span>{phase === "complete" ? "Generate Again" : "Generate"}</span>
        </button>
      </div>

      <FileDropZone
        files={files}
        inputId={fileInputId}
        inputRef={fileInputRef}
        disabled={running}
        onAddFiles={onAddFiles}
        onRemoveFile={onRemoveFile}
      />
    </motion.section>
  );
}
