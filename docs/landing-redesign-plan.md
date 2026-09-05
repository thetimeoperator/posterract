# Posterract landing page redesign — v2 (the bold version)

Status: in build, Sep 4 2026. Supersedes v1. Grounded in `apps/web/src/marketing/*`, `styles/homepage.css`, the 3D relic in `core3d/v2/RelicStage.tsx` (already used on the enter page), and the brand tokens in `packages/hyperkit/src/tokens.css`.

## The idea in one line

**The page is a timeline. Scrolling is scrubbing.** Posterract is a video editor, so the landing page behaves like one: a needle and a time strip pinned along the bottom, the sections laid out as clips on it, and everything on the page keyed to where the playhead is.

## Five pillars

1. **Scroll is the timeline.** A fixed strip along the bottom of the page (`TimelineSpine`) shows the clips (HERO · LOOP · SESSION · SKILLS · NETWORK · ROADMAP · PLAN · SIGNALS), a mono clock (`T 01:12.08`) and a neon needle that advances with scroll. Clicking a clip scrolls to it. Sections cut in as the needle reaches them; numbers count up when their clip starts.
2. **The hero is the editor.** No object, no 3D model (rejected by the founder). The hero *is* the product's canvas: the headline is a selected text layer — it sits inside a real 9:16 scene frame with the editor's selection handles, its dimension badge (`1080×1920`), the `Active` pill and a `+ Skill` chip on the frame's header, on the green-and-black ground with the grid. Around it, faint glass instruments at the edges (the command bar strip, a sliver of the dock with capsules) so the whole viewport reads as the app at rest. Behind the headline frame, two or three more scene frames drift on the canvas at lower opacity, each playing a real exported short (muted, compressed loops of the founder's actual videos: the Zero Point pieces, the Kagurabachi short). On the first scroll the dock's needle starts moving and the frames' captions begin to run — playback begins. The hero says "this is a video editor" without a single word of copy, and the copy sits inside it as the thing being edited.
3. **The page renders itself.** The Agent Session's stage is a real `<canvas>` painted by a small in-page renderer from a scene state (a 9:16 frame, title bar, skill chip, text, avatar slot, captions, playhead). The terminal's tool calls mutate that state; scrolling advances the calls; visitors can also press **Run** on any call. Canvas / Timeline / Code tabs are three views of the same state, which is the product's core promise made literal. Phase 2 swaps the mini renderer for the real runtime (`@posterract/video-runtime` runs in a browser already; it needs a web bundle and a performance budget).
4. **Cinematic pinning.** Three pinned moments only: the Agent Session (the visitor drives the agent), the Skills fan (the deck spreads as you scroll), the Network board (platforms light in sequence). Everything else fades in once. `prefers-reduced-motion` turns all of it into static, finished states.
5. **Type with attitude.** Switzer (already self-hosted) at heavier weights and tighter tracking for the giant `$20` and the section titles; JetBrains-style mono for every label, tool name, time and price; nothing else.

## Section order (the clips)

| Clip | Section | Status |
|---|---|---|
| 00 | **Hero** — keep the shader world and its parallax. New words: *Make the video. Post it everywhere. See what worked.* Two columns: copy left, the Core right. | rebuilt |
| 01 | **The Loop** — MAKE → POST → LEARN as three glass instruments on one neon line with a moving pulse. Replaces Pipeline. | new |
| 02 | **Agent Session** — pinned theater: terminal left, live canvas right, Canvas/Timeline/Code tabs below. | new |
| 03 | **Skills** — the deck fanned across the page, cards with sigils, hover tilt. | new |
| 04 | **Network** — the 8-platform grid, lights in sequence; the redundant LIVE/LIMITED/ROADMAP note removed. | tightened |
| 05 | **Roadmap terminal** | untouched |
| 06 | **Plan** — the pricing plate (below). | rebuilt |
| 07 | **Signals** — a retention-curve instrument and the loop line (*exports carry the scene and version that made them, so performance points back at the edit*). | rebuilt |
| — | Final CTA + footer | untouched |

## Pricing plate

One price as the headline (`$20 / MONTH`, a `MONTHLY · YEARLY` control that flips it to `$200` with `$16.67 / month`), three columns **EDITOR / SCHEDULER / AGENT** of what is inside, then the one line no competitor can copy — **Your AI keys, your prices, no markup** — naming the providers (MiniMax video, Gemini image, Fish voice) at their list prices, not ours. A "replaces" strip in plain words, one button: **Start for $20**. Gone: the spinning crosses, "FULL ACCESS", the checklist, "SECURE CHECKOUT / READY TO LAUNCH", and the Connect/Command/Measure sequence.

## Files

| File | Role |
|---|---|
| `marketing/scroll.ts` NEW | `useSectionProgress` (0..1 for an element crossing the viewport, written to a CSS var, no React renders) and `usePageProgress` |
| `marketing/TimelineSpine.tsx` NEW | the pinned time strip, clips, clock, needle |
| `marketing/HeroCanvas.tsx` NEW | the hero as the editor: headline-as-layer inside a scene frame with handles, badge, chips; drifting scene frames playing real exports; faint instrument slivers at the edges |
| `marketing/LoopBand.tsx` NEW | MAKE / POST / LEARN instruments |
| `marketing/AgentSession.tsx` + `session-scene.ts` NEW | pinned theater, Canvas2D scene renderer, terminal, tabs |
| `marketing/SkillsFan.tsx` NEW | the deck fan |
| `marketing/PricingPlate.tsx` NEW | replaces `components/ui/animated-pricing-card.tsx` |
| `marketing/Signals.tsx` NEW | retention instrument |
| `marketing/Homepage.tsx` | new order, spine mounted, Pipeline removed |
| `styles/homepage.css` | styles for all of the above appended; card/cross styles unused |

## Acceptance

"Editor" visible above the fold. Canvas, timeline and code seen before pricing. The plate fits one laptop screen. The spine never covers content (the page gets bottom padding equal to the spine's height). Reduced motion: no pinning, finished states. Typecheck and build clean. Performance no worse than today: the relic mounts lazily after first paint, the theater canvas is 2× DPR max.
