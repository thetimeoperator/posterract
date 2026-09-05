import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Clapperboard, HardDrive } from "lucide-react";
import { Button, Modal, pushSignal } from "@posterract/hyperkit";
import { DesktopDownloads, anyDesktopBuild } from "@/components/DesktopDownloads";
import { desktopRequest, isPosterractDesktop } from "@/lib/desktop";
import { refreshPostgresEngine } from "@/engine/postgres";

type LocalExport = {
  path: string;
  fileName: string;
  contentType: string;
  durationMs?: number;
  /** Where the render came from, carried through to the uploaded asset. */
  projectId?: string | null;
  sceneId?: string | null;
  sourceRevision?: string | null;
  width?: number | null;
  height?: number | null;
};

export const Route = createFileRoute("/_app/create")({
  component: CreateRoute,
});

const SANDBOX_URL =
  (import.meta.env.VITE_EDITOR_SANDBOX_URL as string | undefined)?.replace(/\/$/, "") ??
  (import.meta.env.DEV ? "http://127.0.0.1:5175" : "/editor-sandbox");

/**
 * Creating a video happens in Posterract Desktop, never in the browser: the
 * project is a folder of TSX on the user's own computer, the canvas compiles
 * it locally, renders are written to their disk, and the agent bridge is a
 * local process. A browser tab can do none of that, so the web build offers
 * the download instead of a second, weaker editor.
 */
function CreateRoute() {
  return isPosterractDesktop() ? <DesktopEditorHost /> : <DownloadDesktop />;
}

const REASONS = [
  {
    icon: HardDrive,
    title: "Your projects are folders",
    body: "A Posterract project is TSX source on your disk. The app compiles it into the canvas and writes your edits straight back to the file.",
  },
  {
    icon: Bot,
    title: "Your agent runs locally",
    body: "Codex, Claude Code, Cursor or VS Code connect to the canvas through your project folder. No browser can hand them that.",
  },
  {
    icon: Clapperboard,
    title: "Renders land on your machine",
    body: "Export is local and immediate. Nothing is uploaded until you choose to schedule or post it.",
  },
];

function DownloadDesktop() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="max-w-2xl">
        <p className="kicker">The editor</p>
        <h1 className="mt-3 font-display text-[34px] leading-[1.1] font-semibold text-starlight">
          Making videos happens in the desktop app.
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-starlight-dim">
          Scheduling, analytics and your connected accounts live here on the web. The canvas does
          not — it needs your filesystem, your agent, and your GPU.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <DesktopDownloads />
        </div>

        {anyDesktopBuild ? null : (
          <p className="mt-3 text-[11px] leading-relaxed text-starlight-faint">
            Signed builds are on the way. The editor runs on your own machine, so there is nothing
            to try in the browser until then.
          </p>
        )}
      </div>

      <div className="mt-12 grid gap-3 sm:grid-cols-3">
        {REASONS.map(({ icon: Glyph, title, body }) => (
          <div key={title} className="rounded-[15px] border border-white/[0.08] bg-black/15 p-5">
            <Glyph size={17} className="text-neon" />
            <p className="mt-3 font-display text-[13px] font-semibold text-starlight">{title}</p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-starlight-faint">{body}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-[11px] leading-relaxed text-starlight-faint">
        Already installed? Open Posterract from your Applications folder — everything you schedule
        here stays in sync with the account you are signed into there.
      </p>
    </div>
  );
}

/**
 * Inside Posterract Desktop this route is the editor's host: it renders the
 * sandboxed editor and relays its bridge traffic to the main process, then
 * offers a finished export to the cloud composer on the user's say-so.
 */
function DesktopEditorHost() {
  const navigate = useNavigate();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [localExport, setLocalExport] = useState<LocalExport>();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    const emit = (channel: string, payload: unknown) => {
      iframe.current?.contentWindow?.postMessage(
        { type: "posterract-editor-bridge", channel: "main:event", payload: { channel, data: payload } },
        "*",
      );
    };

    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "posterract-cli-response") {
        window.desktop?.send("cli:response", event.data.payload);
        return;
      }
      if (
        event.data?.type === "posterract-editor-navigate" &&
        (event.data.path === "/continuum" || event.data.path === "/uplink")
      ) {
        void navigate({ to: event.data.path });
        return;
      }
      if (event.data?.type === "posterract-export-complete") {
        const local: LocalExport = {
          path: String(event.data.path),
          fileName: String(event.data.fileName ?? "posterract-export.mp4"),
          contentType: String(event.data.contentType ?? "video/mp4"),
          durationMs: Number(event.data.durationMs) || undefined,
          projectId: event.data.projectId ?? null,
          sceneId: event.data.sceneId ?? null,
          sourceRevision: event.data.sourceRevision ?? null,
          width: event.data.width ?? null,
          height: event.data.height ?? null,
        };
        setLocalExport(local);
        setUploadProgress(0);
        // A render that just finished offers the choice; one picked from the
        // exports library already made it, so it goes straight through.
        const intent = event.data.intent;
        if (intent === "schedule" || intent === "post") {
          void sendExportToComposer(intent === "schedule", local);
        }
        return;
      }
      const message = event.data as {
        type?: string;
        channel?: string;
        payload?: { id?: string; channel?: string; data?: Record<string, unknown> };
      };
      if (
        message.type !== "posterract-editor-request" ||
        message.channel !== "main:request" ||
        !message.payload?.id ||
        !message.payload.channel
      ) {
        return;
      }
      const { id, channel, data } = message.payload;
      void desktopRequest(channel, data)
        .then((result) => {
          iframe.current?.contentWindow?.postMessage(
            { type: "posterract-editor-bridge", channel: "main:response", payload: { id, ok: true, data: result } },
            "*",
          );
        })
        .catch((cause) => {
          iframe.current?.contentWindow?.postMessage(
            {
              type: "posterract-editor-bridge",
              channel: "main:response",
              payload: { id, ok: false, error: cause instanceof Error ? cause.message : String(cause) },
            },
            "*",
          );
        });
    };

    window.addEventListener("message", receive);
    const stopDesktopEvents = window.desktop?.on("main:event", (payload) => {
      const event = payload as { channel?: string; data?: unknown };
      if (event.channel === "cloud:upload-progress") {
        const data = event.data as { path?: string; progress?: number };
        if (data.path === localExport?.path && Number.isFinite(data.progress)) {
          setUploadProgress(Number(data.progress));
        }
      }
      if (event.channel) emit(event.channel, event.data);
    });
    return () => {
      window.removeEventListener("message", receive);
      stopDesktopEvents?.();
    };
  }, [localExport?.path, navigate]);

  const sendExportToComposer = async (schedule: boolean, entry?: LocalExport) => {
    const target = entry ?? localExport;
    if (!target) return;
    setUploading(true);
    setUploadProgress(0.01);
    try {
      const result = await desktopRequest<{ mediaId: string }>("cloud:upload-file", {
        path: target.path,
        contentType: target.contentType,
        durationMs: target.durationMs,
        projectId: target.projectId,
        sceneId: target.sceneId,
        sourceRevision: target.sourceRevision,
        width: target.width,
        height: target.height,
      });
      await refreshPostgresEngine();
      setLocalExport(undefined);
      await navigate({
        to: "/compose",
        search: schedule
          ? { artifact: result.mediaId, at: Date.now() + 60 * 60 * 1_000 }
          : { artifact: result.mediaId },
      });
    } catch (cause) {
      pushSignal({
        tone: "danger",
        title: "Cloud handoff failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <section className="create-sandbox-host" aria-label="Posterract video editor">
      <iframe
        ref={iframe}
        title="Posterract Create editor"
        // The explicit root hash stops Chromium restoring the iframe's last
        // in-project hash after a restart: Create always enters through the
        // project library, and opening a project happens inside that session.
        src={`${SANDBOX_URL}/#/`}
        onLoad={() => {
          const pending = window.__posterractPendingCliRequests ?? [];
          delete window.__posterractPendingCliRequests;
          for (const payload of pending) {
            iframe.current?.contentWindow?.postMessage({ type: "posterract-cli-request", payload }, "*");
          }
        }}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-pointer-lock"
        allow="autoplay; fullscreen; clipboard-write"
      />
      <Modal
        open={Boolean(localExport)}
        onClose={() => !uploading && setLocalExport(undefined)}
        kicker="Local export complete"
        title={localExport?.fileName ?? "Video exported"}
        footer={
          <>
            <Button variant="tertiary" disabled={uploading} onClick={() => setLocalExport(undefined)}>Done</Button>
            <Button variant="secondary" disabled={uploading} onClick={() => void sendExportToComposer(true)}>Schedule</Button>
            <Button variant="primary" disabled={uploading} onClick={() => void sendExportToComposer(false)}>Post now</Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-starlight-dim">
          The finished video is saved on your computer. Posterract uploads it only if you continue to
          posting or scheduling.
        </p>
        {uploading && (
          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-neon transition-[width]"
                style={{ width: `${Math.max(2, uploadProgress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-starlight-faint">
              Uploading directly to R2 · {Math.round(uploadProgress * 100)}%
            </p>
          </div>
        )}
      </Modal>
    </section>,
    document.body,
  );
}
