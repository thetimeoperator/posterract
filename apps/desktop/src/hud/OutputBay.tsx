import { Download, Film, FileText, Image as ImageIcon, Send } from "lucide-react";
import { motion } from "framer-motion";
import type { ContentCapsule, RunArtifact, VidtryxPhase } from "../state/types";

type OutputBayProps = {
  artifacts: RunArtifact[];
  outputUrl?: string;
  phase: VidtryxPhase;
  capsule?: ContentCapsule;
  onSendToPost?: (capsuleId: string) => void;
};

function ArtifactIcon({ type }: { type: RunArtifact["type"] }) {
  if (type === "script") return <FileText size={15} />;
  if (type === "preview") return <ImageIcon size={15} />;
  return <Film size={15} />;
}

export function OutputBay({ artifacts, outputUrl, phase, capsule, onSendToPost }: OutputBayProps) {
  return (
    <motion.aside
      className="output-bay hud-panel"
      initial={{ x: 34, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut", delay: 0.08 }}
    >
      <div className="panel-kicker">
        <Film size={14} />
        <span>Output Bay</span>
      </div>

      <div className="preview-frame" data-testid="output-preview">
        {outputUrl ? (
          <video src={outputUrl} controls muted playsInline />
        ) : (
          <div className="preview-empty">
            <Film size={36} />
            <span>{phase === "running" ? "Rendering" : "Awaiting output"}</span>
          </div>
        )}
      </div>

      <div className="artifact-list">
        {artifacts.length === 0 && <span className="empty-artifacts">No artifacts yet</span>}
        {artifacts.map((artifact) => (
          <div className="artifact-row" key={artifact.id}>
            <ArtifactIcon type={artifact.type} />
            <span>{artifact.label}</span>
            {artifact.url && (
              <a href={artifact.url} aria-label={`Open ${artifact.label}`}>
                <Download size={14} />
              </a>
            )}
          </div>
        ))}
      </div>

      {phase === "complete" && capsule && onSendToPost && (
        <button data-testid="send-to-post" className="ghost-button output-send" type="button" onClick={() => onSendToPost(capsule.id)}>
          <Send size={14} />
          Send to Post
        </button>
      )}
    </motion.aside>
  );
}
