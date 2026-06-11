import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Pencil, Send, Trash2 } from "lucide-react";
import { Button, EmptyState, Input, Modal, Panel, ProgressBeam, pushSignal } from "@posterract/hyperkit";
import type { ArtifactDTO } from "@posterract/contract";
import { VideoDropzone } from "@/components/VideoDropzone";
import { ArtifactThumb } from "@/components/ArtifactThumb";
import { useArtifacts, useEngineActions, useTransmissions } from "@/engine/useEngine";
import { aspectLabel, formatBytes, formatDuration } from "@/lib/fmt";

export const Route = createFileRoute("/_app/vault")({
  component: Vault,
});

const HOLD_CAPACITY_BYTES = 10 * 1024 ** 3; // demo display cap, mirrors the free R2 tier

function Vault() {
  const artifacts = useArtifacts();
  const transmissions = useTransmissions();
  const { deleteArtifact, renameArtifact } = useEngineActions();
  const [renaming, setRenaming] = useState<ArtifactDTO | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const usedBytes = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
  const usedIn = (id: string) => transmissions.filter((t) => t.artifactId === id).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel kicker="Intake" title="Add to the Vault" brackets>
          <VideoDropzone
            compact
            onReady={(a) =>
              pushSignal({ tone: "success", title: "Artifact secured", detail: `“${a.fileName}” is in the Vault.` })
            }
          />
        </Panel>
        <Panel kicker="Hold capacity" title={formatBytes(usedBytes)} brackets>
          <ProgressBeam value={usedBytes / HOLD_CAPACITY_BYTES} label="Storage used" />
          <p className="telemetry mt-2 text-[11px] text-starlight-faint">
            {formatBytes(usedBytes)} / {formatBytes(HOLD_CAPACITY_BYTES)} · {artifacts.length} artifact
            {artifacts.length === 1 ? "" : "s"}
          </p>
        </Panel>
      </div>

      {artifacts.length === 0 ? (
        <Panel className="min-h-[40vh]">
          <EmptyState
            title="The Vault is empty."
            detail="Drop a video above — every artifact you add is kept here, ready to transmit."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {artifacts.map((a) => (
            <Panel key={a.id} shimmer className="!p-3">
              <ArtifactThumb artifactId={a.id} className="aspect-[9/16] w-full" />
              <p className="mt-2 truncate text-[12px] font-medium text-starlight" title={a.fileName}>
                {a.fileName}
              </p>
              <p className="telemetry mt-0.5 text-[10px] text-starlight-faint">
                {formatDuration(a.durationMs)} · {aspectLabel(a.width, a.height)} · {formatBytes(a.sizeBytes)}
              </p>
              <p className="telemetry text-[10px] text-starlight-faint">
                used in {usedIn(a.id)} transmission{usedIn(a.id) === 1 ? "" : "s"}
              </p>
              <div className="mt-2 flex items-center gap-1">
                <Link to="/compose" search={{ artifact: a.id }} className="flex-1">
                  <Button size="sm" variant="primary" icon={<Send size={12} />} className="w-full">
                    Transmit
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Rename ${a.fileName}`}
                  onClick={() => {
                    setRenaming(a);
                    setRenameValue(a.fileName);
                  }}
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Delete ${a.fileName}`}
                  onClick={() => {
                    const res = deleteArtifact(a.id);
                    if (!res.ok) {
                      pushSignal({ tone: "warning", title: "Can’t delete", detail: res.reason });
                    } else {
                      pushSignal({ tone: "info", title: "Artifact released", detail: a.fileName });
                    }
                  }}
                >
                  <Trash2 size={12} className="text-redshift" />
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        kicker="Rename"
        title="Rename artifact"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renaming && renameValue.trim()) renameArtifact(renaming.id, renameValue.trim());
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input label="File name" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
      </Modal>
    </div>
  );
}
