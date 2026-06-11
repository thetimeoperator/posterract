import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import {
  Avatar,
  Button,
  ConstellationGlyph,
  Countdown,
  EmptyState,
  GridHorizon,
  Hint,
  Input,
  MiniTesseract,
  Modal,
  OrbitRing,
  Panel,
  PlatformChip,
  PlatformRuneRow,
  ProgressBeam,
  ProgressComet,
  Segmented,
  SignalHost,
  Skeleton,
  StatusBadge,
  Starfield,
  Tabs,
  Telemetry,
  Textarea,
  Toggle,
  pushSignal,
} from "@posterract/hyperkit";
import { PLATFORM_IDS } from "@posterract/contract";
import type { BadgeStatus } from "@posterract/hyperkit";

export const Route = createFileRoute("/dev/hyperkit")({
  component: Gallery,
});

const ALL_STATUSES: BadgeStatus[] = [
  "draft",
  "scheduled",
  "transmitting",
  "uploading",
  "publishing",
  "processing",
  "live",
  "partial",
  "failed",
  "retrying",
  "needs_reauth",
  "blocked",
  "canceled",
];

function Gallery() {
  const [toggle, setToggle] = useState(true);
  const [segment, setSegment] = useState<"now" | "at" | "next_slot">("at");
  const [tab, setTab] = useState<"base" | "instagram" | "x">("base");
  const [modalOpen, setModalOpen] = useState(false);
  const [caption, setCaption] = useState("Five AI tools that are criminally underrated right now…");
  const [selected, setSelected] = useState<string[]>(["instagram", "tiktok"]);

  return (
    <div className="relative min-h-screen bg-void-0 pb-24">
      <div className="pointer-events-none fixed inset-0">
        <Starfield />
      </div>
      <GridHorizon className="fixed" />

      <div className="relative z-10 mx-auto max-w-5xl space-y-8 px-6 py-10">
        <header className="flex items-center gap-4">
          <MiniTesseract size={34} />
          <div>
            <p className="kicker">Hyperkit — design system</p>
            <h1 className="font-display text-2xl font-bold text-starlight">Component Gallery</h1>
          </div>
          <div className="ml-auto flex gap-3">
            <MiniTesseract size={26} state="idle" />
            <MiniTesseract size={26} state="transmitting" />
            <MiniTesseract size={26} state="error" />
          </div>
        </header>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<Send size={14} />}>
              Initiate Transmission
            </Button>
            <Button variant="secondary">Open portal</Button>
            <Button variant="tertiary">Skip for now</Button>
            <Button variant="destructive">Cancel transmission</Button>
            <Button variant="primary" loading>
              Transmitting
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="primary" size="md">
              Medium
            </Button>
            <Button variant="primary" size="lg">
              Large
            </Button>
          </div>
        </Section>

        <Section title="Status badges">
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title="Platform chips & runes">
          <div className="flex flex-wrap gap-2">
            {PLATFORM_IDS.map((p) => (
              <PlatformChip
                key={p}
                platform={p}
                selected={selected.includes(p)}
                onClick={() =>
                  setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
                }
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <PlatformRuneRow
              platforms={[...PLATFORM_IDS]}
              statusDots={{ instagram: "live", tiktok: "transmitting", x: "failed", youtube: "pending" }}
            />
            <span className="text-[12px] text-starlight-faint">mini row with status dots</span>
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid max-w-xl gap-4">
            <Input label="Transmission title" placeholder="Internal name for this post" />
            <Input label="With error" error="That dimension rejected the value." defaultValue="bad value" />
            <Textarea
              label="Base caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxChars={280}
              hint="X truncates at 280 characters."
            />
          </div>
        </Section>

        <Section title="Toggle · Segmented · Tabs">
          <div className="max-w-xl space-y-5">
            <Toggle
              checked={toggle}
              onChange={setToggle}
              label="Ship audio"
              description="Soft sonar ping when a transmission goes live."
            />
            <Segmented
              aria-label="Schedule mode"
              value={segment}
              onChange={setSegment}
              options={[
                { value: "now", label: "Now" },
                { value: "at", label: "At time" },
                { value: "next_slot", label: "Next free slot" },
              ]}
            />
            <Tabs
              aria-label="Caption variants"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "base", label: "Base" },
                { value: "instagram", label: "Instagram" },
                { value: "x", label: "X", alert: true },
              ]}
            />
          </div>
        </Section>

        <Section title="Progress">
          <div className="max-w-xl space-y-5">
            <ProgressBeam value={0.62} label="Upload progress" />
            <ProgressComet label="Working" />
            <div className="flex items-center gap-6">
              <OrbitRing value={0.47} label="Encapsulating">
                <span className="telemetry text-[11px] text-starlight">47%</span>
              </OrbitRing>
              <OrbitRing value={0.9} size={44} label="Almost done">
                <span className="telemetry text-[10px] text-starlight">90%</span>
              </OrbitRing>
            </div>
          </div>
        </Section>

        <Section title="Panels">
          <div className="grid gap-4 md:grid-cols-2">
            <Panel kicker="Continuum" title="Glass panel" shimmer>
              <p className="text-[13px] text-starlight-dim">Hover for the holo-shimmer sweep.</p>
            </Panel>
            <Panel kicker="The Bridge" title="With brackets" brackets>
              <p className="text-[13px] text-starlight-dim">Corner brackets, HUD heritage.</p>
            </Panel>
          </div>
        </Section>

        <Section title="Modal · Signals (toasts) · Tooltip">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setModalOpen(true)}>Open portal modal</Button>
            <Button
              onClick={() =>
                pushSignal({ tone: "success", title: "Transmission live", detail: "Instagram projection confirmed → reel/Cx12" })
              }
            >
              Success signal
            </Button>
            <Button
              onClick={() =>
                pushSignal({ tone: "danger", title: "Projection failed", detail: "X media processing error — retrying in 60s" })
              }
            >
              Danger signal
            </Button>
            <Hint text="T-minus until publish">
              <Countdown to={Date.now() + 3 * 3600_000 + 47_000} />
            </Hint>
          </div>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            kicker="Confirm"
            title="Initiate transmission now?"
            footer={
              <>
                <Button variant="tertiary" onClick={() => setModalOpen(false)}>
                  Abort
                </Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>
                  Engage
                </Button>
              </>
            }
          >
            <p className="text-[13px] text-starlight-dim">
              This will publish immediately to <strong className="text-starlight">4 platforms</strong>. The unfold
              cannot be recalled.
            </p>
          </Modal>
        </Section>

        <Section title="Bits — skeleton · avatar · telemetry · empty state">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name="Sina Pahlevan" presence="online" />
                <Avatar name="Posterract Bot" size={40} />
              </div>
              <Telemetry
                rows={[
                  { k: "token", v: "≈ 54d", tone: "good" },
                  { k: "ig window", v: "14/100 · 24h" },
                  { k: "x portal", v: "expired", tone: "bad" },
                ]}
              />
            </div>
          </div>
          <div className="mt-4 grid md:grid-cols-2">
            <EmptyState
              title="No transmissions in trajectory."
              detail="Compose your first and project it across six dimensions."
              action={<Button variant="primary">Compose</Button>}
            />
            <EmptyState glyph={<ConstellationGlyph size={90} />} title="Listening for echoes…" detail="Analytics calibrate after your first published transmissions." />
          </div>
        </Section>
      </div>
      <SignalHost />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="kicker !text-[12px]">{title}</h2>
      <div className="glass rounded-[var(--radius-panel)] p-5">{children}</div>
    </section>
  );
}
