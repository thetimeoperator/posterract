import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Modal, pushSignal } from "@posterract/hyperkit";
import {
  ensureCreativeProject,
  handleCreativeBridgeRequest,
  type CreativeProject,
} from "@/creative/bridge";
import { desktopRequest, isPosterractDesktop } from "@/lib/desktop";
import { refreshPostgresEngine } from "@/engine/postgres";
import { refreshCredits } from "@/engine/useEngine";
import { handleAiBridgeRequest, serializeAiBridgeError } from "@/lib/ai";

type LocalExport = {
  path: string;
  fileName: string;
  contentType: string;
  durationMs?: number;
};

export const Route = createFileRoute("/_app/create")({
  component: CreateEditorHost,
});

const SANDBOX_URL =
  (import.meta.env.VITE_EDITOR_SANDBOX_URL as string | undefined)?.replace(/\/$/, "") ??
  (import.meta.env.DEV ? "http://127.0.0.1:5175" : "/editor-sandbox");

function CreateEditorHost() {
  const navigate = useNavigate();
  const iframe = useRef<HTMLIFrameElement>(null);
  const desktop = isPosterractDesktop();
  const [project, setProject] = useState<CreativeProject>();
  const [error, setError] = useState("");
  const [localExport, setLocalExport] = useState<LocalExport>();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    // Desktop owns a real project library on disk. Its editor opens at the
    // project browser instead of silently creating or choosing a project.
    if (desktop) return;

    let active = true;
    const load = ensureCreativeProject();
    void load
      .then((value) => {
        if (active) setProject(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    const emit = (channel: string, payload: unknown) => {
      iframe.current?.contentWindow?.postMessage(
        { type: "posterract-editor-bridge", channel: "main:event", payload: { channel, data: payload } },
        "*",
      );
    };

    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "posterract-cli-response" && isPosterractDesktop()) {
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
      if (event.data?.type === "posterract-ai-request") {
        // AI generation bridge: the editor asks, the host talks to the API
        // with the workspace's own authenticated transport (cookies in the
        // browser, the Electron main process on Desktop). The editor iframe
        // never holds credentials.
        const { id, action, payload } = event.data as {
          id?: unknown;
          action?: unknown;
          payload?: unknown;
        };
        if (typeof id !== "string" || !id) return;
        const respond = (body: { ok: boolean; data?: unknown; error?: unknown }) => {
          iframe.current?.contentWindow?.postMessage(
            { type: "posterract-ai-response", id, ...body },
            "*",
          );
        };
        void handleAiBridgeRequest(action, payload)
          .then((data) => {
            respond({ ok: true, data });
            // Executed generations and transcriptions move credits — keep the
            // header pill honest without blocking the editor's response.
            if (action === "execute" || action === "transcribe") {
              void refreshCredits().catch(() => undefined);
            }
          })
          .catch((cause) => respond({ ok: false, error: serializeAiBridgeError(cause) }));
        return;
      }
      if (event.data?.type === "posterract-export-complete" && isPosterractDesktop()) {
        setLocalExport({
          path: String(event.data.path),
          fileName: String(event.data.fileName ?? "posterract-export.mp4"),
          contentType: String(event.data.contentType ?? "video/mp4"),
          durationMs: Number(event.data.durationMs) || undefined,
        });
        setUploadProgress(0);
        return;
      }
      const message = event.data as {
        type?: string;
        channel?: string;
        payload?: { id?: string; channel?: string; data?: Record<string, unknown> };
      };
      if (message.type !== "posterract-editor-request" || message.channel !== "main:request" || !message.payload?.id || !message.payload.channel) return;
      const { id, channel, data } = message.payload;
      const operation = isPosterractDesktop()
        ? desktopRequest(channel, data)
        : handleCreativeBridgeRequest(channel, data, emit);
      void operation
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
    const stopDesktopEvents = isPosterractDesktop()
      ? window.desktop?.on("main:event", (payload) => {
          const event = payload as { channel?: string; data?: unknown };
          if (event.channel === "cloud:upload-progress") {
            const data = event.data as { path?: string; progress?: number };
            if (data.path === localExport?.path && Number.isFinite(data.progress)) {
              setUploadProgress(Number(data.progress));
            }
          }
          if (event.channel) emit(event.channel, event.data);
        })
      : undefined;
    return () => {
      window.removeEventListener("message", receive);
      stopDesktopEvents?.();
    };
  }, [localExport?.path, navigate]);

  const sendExportToComposer = async (schedule: boolean) => {
    if (!localExport) return;
    setUploading(true);
    setUploadProgress(0.01);
    try {
      const result = await desktopRequest<{ mediaId: string }>("cloud:upload-file", {
        path: localExport.path,
        contentType: localExport.contentType,
        durationMs: localExport.durationMs,
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

  if (error) {
    return createPortal(
      <div className="create-sandbox-state">
        <strong>CREATE RUNTIME FAILED</strong>
        <p>{error}</p>
      </div>,
      document.body,
    );
  }

  if (!desktop && !project) {
    return createPortal(
      <div className="create-sandbox-state">
        <span />
        <strong>MOUNTING DIFFUSION RUNTIME</strong>
        <p>Loading the current Posterract project revision.</p>
      </div>,
      document.body,
    );
  }

  // The explicit root hash prevents Chromium from restoring the iframe's
  // last in-project hash after an app restart. Create must always enter
  // through the desktop project library; opening a project then happens
  // inside that stable iframe session.
  const sandboxSrc = desktop
    ? `${SANDBOX_URL}/#/`
    : `${SANDBOX_URL}/?project=${encodeURIComponent(project!.id)}`;

  return createPortal(
    <section className="create-sandbox-host" aria-label="Posterract video editor">
      <iframe
        ref={iframe}
        title="Posterract Create editor"
        src={sandboxSrc}
        onLoad={() => {
          const pending = window.__posterractPendingCliRequests ?? [];
          delete window.__posterractPendingCliRequests;
          for (const payload of pending) {
            iframe.current?.contentWindow?.postMessage(
              { type: "posterract-cli-request", payload },
              "*",
            );
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
          The finished video is saved on your computer. Posterract uploads it only if you continue to posting or scheduling.
        </p>
        {uploading && (
          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-neon transition-[width]" style={{ width: `${Math.max(2, uploadProgress * 100)}%` }} />
            </div>
            <p className="mt-2 text-[10px] text-starlight-faint">Uploading directly to R2 · {Math.round(uploadProgress * 100)}%</p>
          </div>
        )}
      </Modal>
    </section>,
    document.body,
  );
}
