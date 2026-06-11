/**
 * First-run sample content — generates three tiny REAL videos in the
 * browser (canvas → MediaRecorder) and schedules example posts across
 * past and future days, so Dashboard, Calendar, Posts, and Analytics
 * open populated like a working tool. Clearly labeled; removable in
 * Settings → Clear local data.
 */
import { useEngineStore } from "./store";

const FLAG = "posterract.samples";

type SampleSpec = {
  fileTitle: string;
  bg: [string, string];
  postTitle: string;
  caption: string;
  platforms: Array<"instagram" | "tiktok" | "youtube" | "x">;
  /** Offset in hours from now; negative = past (seeded as published). */
  offsetH: number;
};

const SPECS: SampleSpec[] = [
  {
    fileTitle: "morning-routine.webm",
    bg: ["#0a3d2c", "#65ff9a"],
    postTitle: "Sample: Morning routine that fixed my focus",
    caption: "Five changes, thirty days, completely different brain.",
    platforms: ["instagram", "tiktok", "youtube"],
    offsetH: -52,
  },
  {
    fileTitle: "behind-the-scenes.webm",
    bg: ["#0a2c3d", "#7cf7ff"],
    postTitle: "Sample: Behind the scenes — studio build",
    caption: "What it actually took to build this in a spare room.",
    platforms: ["instagram", "tiktok"],
    offsetH: -26,
  },
  {
    fileTitle: "product-drop.webm",
    bg: ["#1d3a2c", "#eafff3"],
    postTitle: "Sample: Product drop teaser",
    caption: "Something is unfolding. Friday, 9am.",
    platforms: ["instagram", "tiktok", "youtube", "x"],
    offsetH: 30,
  },
];

/**
 * Render ~1.2s of animated gradient + title card and record it as webm.
 * Uses manual frame capture (captureStream(0) + requestFrame) with a hard
 * stop — completes even in throttled/background tabs where rAF never fires.
 */
async function generateClip(spec: SampleSpec): Promise<File | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 270;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof MediaRecorder === "undefined") return null;

    const draw = (t: number) => {
      const g = ctx.createLinearGradient(0, 0, 270, 480 + Math.sin(t * 3) * 120);
      g.addColorStop(0, spec.bg[0]);
      g.addColorStop(1, "#05080b");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 270, 480);
      ctx.strokeStyle = spec.bg[1];
      ctx.lineWidth = 1.5;
      const s = 70 + Math.sin(t * 2.2) * 12;
      ctx.strokeRect(135 - s / 2, 240 - s / 2, s, s);
      ctx.strokeRect(135 - s / 4, 240 - s / 4, s / 2, s / 2);
      ctx.fillStyle = spec.bg[1];
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SAMPLE CLIP", 135, 400);
    };

    draw(0); // ensure at least one painted frame before capture starts

    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 250_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });

    rec.start();
    track.requestFrame?.();

    // Opportunistic frames; the hard stop below guarantees completion.
    const t0 = performance.now();
    const frameTimer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t > 1.25) return;
      draw(t);
      track.requestFrame?.();
    }, 80);

    await new Promise((r) => setTimeout(r, 1400)); // hard stop
    clearInterval(frameTimer);
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    const blob = await done;
    track.stop();
    if (blob.size < 500) return null;
    return new File([blob], spec.fileTitle, { type: "video/webm" });
  } catch {
    return null;
  }
}

/** Seed once per browser. Runs in the background after first boot. */
export async function seedSamplesOnce(): Promise<void> {
  if (window.localStorage.getItem(FLAG)) return;
  window.localStorage.setItem(FLAG, "seeding");
  const store = useEngineStore.getState;

  // If the user already has content (e.g. flag got cleared), don't pollute.
  if (store().transmissions.length > 0 || store().artifacts.length > 0) {
    window.localStorage.setItem(FLAG, "done");
    return;
  }

  for (const spec of SPECS) {
    const file = await generateClip(spec);
    if (!file) continue;
    const artifact = await store().addArtifact(file, { durationMs: 1200, width: 270, height: 480 });
    const when = Date.now() + spec.offsetH * 3600_000;
    const t = store().createTransmission({
      title: spec.postTitle,
      baseCaption: spec.caption,
      hashtags: ["sample"],
      artifactId: artifact.id,
      platforms: spec.platforms,
      perPlatformCaptions: {},
      scheduleMode: "at",
      scheduledFor: when,
    });
    // Past samples: mark their projections live instantly (seeded history,
    // not run through the simulator).
    if (spec.offsetH < 0) {
      for (const projection of store().projections.filter((p) => p.transmissionId === t.id)) {
        const postId = Math.random().toString(36).slice(2, 10);
        store()._updateProjection(projection.id, {
          status: "live",
          platformPostId: postId,
          platformPostUrl: `https://${projection.provider === "youtube" ? "youtube.com/shorts" : `${projection.provider}.com/p`}/${postId}`,
        });
      }
      store()._refreshTransmissionStatus(t.id);
    }
  }
  window.localStorage.setItem(FLAG, "done");
}
