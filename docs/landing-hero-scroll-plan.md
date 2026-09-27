# The product hero: cluster, spread, tilt

Status: plan + build, Sep 14 2026. Product mode of the two-mode landing page, in the preview at `/preview/landing`. The live page is untouched.

## One sentence

Under a slim nav and a headline pinned high, a cluster of videos made in the editor fans out as you scroll, drifts off, and the editor itself rises in as a tilted 3D card that straightens as you keep scrolling — all of it over the green shader world and its parallax, which never breaks.

## The frame

- **Nav.** Slim and fixed to the top: 52px, transparent over the world, a dark blur once the page has scrolled. Brand left, the mode's sections centre, Sign in and the CTA right. Same items as now (Switzer, letter-swap on hover), no box, no clipped corners.
- **Pinned header.** The hero is one sticky viewport that lasts 480vh of scroll. Its top 40% holds, in order: the mode switch (the capsule with the breathing glow), the H1 at a tighter size (`clamp(40px, 4.6vw, 62px)`), the lede, the two buttons. This block never moves while the stage below plays.
- **Stage.** The lower 60% of the viewport, anchored at 58% of its height. Everything in it is driven by one number: the section's scroll progress `p` from 0 to 1.
- **World.** The existing shader, stars, grid and aurora with their parallax, behind everything, through the hero and on through Network and Roadmap. The canvas overrun fix stays; because the hero is taller now, the canvas's own shift is capped at 200px so no edge can ever show.

## Choreography

| `p` | Cards (part 1) | Editor card (part 2) | Text |
|---|---|---|---|
| 0.00 – 0.10 | Clustered at the anchor: eight portrait videos fanned at –18° to +20°, scale 0.82, playing. | Hidden below the fold. | Scroll hint at the bottom: "Scroll", chevron. |
| 0.10 – 0.50 | Spread to their spots across the stage: rotation to 0, scale to each card's rest scale. Pointer parallax fades in with depth per card once spread. | — | Hint gone. At 0.36 a caption fades in at the anchor: "Made in Posterract. Five formats, one editor." |
| 0.50 – 0.68 | Keep drifting outward past their spots, scale to 0.9, fade to 0. | Rises from below: opacity 0→1, translateY 32vh→0, rotateX 90°→58°, rotateZ 0→–22°, scale 0.82→1. Its layers already answer the pointer. | Caption changes to "The editor. Your agent works in it with you." |
| 0.68 – 1.00 | Gone. | Straightens: rotateX 58°→0, rotateZ –22°→0, scale 1→1.02, settling with its top just under the header and its bottom bleeding off the fold. Pointer tilt narrows to ±3°. | — |

After `p = 1` the sticky releases and the page scrolls on to Network.

## The cards

Eight clips, all the founder's exports, five seconds each from the founder's Desktop: Post Mortem 01, EP01 The Multiplier, Post Mortem 02, HyperSpell, iPhone FOMO, PONS, Quantum AI God, Implanted Thoughts. Each card: `<video muted loop autoplay playsinline>` with a poster, 540 wide, 5s, 4px radius on desktop, a 1px mint edge at 12%. Cluster offsets, spread targets and rest scales are per card, in vw/vh from the anchor, so the composition holds at any size. On touch devices the cards land in a two-column grid and the pointer parallax is off.

## The editor card

One screenshot of the real editor, split into depth layers with `clip-path` on stacked copies of the same image, so nothing is redrawn and nothing is a mini version:

| Layer | Region | Depth |
|---|---|---|
| Ground | the whole frame | 0 |
| Scene | the frame on the canvas | 40px |
| Instruments | the floating panels and the timeline dock | 80px |
| Grid | the 84px chamber grid, neon at 12% | 120px |

Pointer: the card rotates with the mouse (x/25, y/25 like the reference, spring-smoothed) and each layer shifts by its depth. Entrance and settle are scroll-driven, not timed, so the card is wherever the scroll left it. Corner radius 14px, a 1px neon edge, a long soft shadow toward the ground.

## Files

| File | Role |
|---|---|
| `apps/web/src/components/ui/stack-spread.tsx` NEW | The cluster and spread, adapted from the vault component: takes the cards and a progress motion value, anchors below the header, exits on cue. |
| `apps/web/src/components/ui/tilt-card.tsx` NEW | The 3D layered card, adapted from the Halide hero: scroll-driven enter and settle, pointer tilt, clip-path depth layers, the chamber grid. |
| `apps/web/src/marketing/hero/HeroStage.tsx` NEW | The 480vh section: sticky viewport, pinned header (switch + copy), stage, captions, scroll hint, reduced-motion state. |
| `apps/web/src/marketing/Landing.tsx` | Slim fixed nav for both modes; product mode renders `HeroStage`. |
| `apps/web/src/styles/landing-two-mode.css` | Nav, stage, cards, card, captions. |
| `apps/web/src/styles/homepage.css` | Cap on the canvas parallax shift. |
| `apps/web/public/brand/hero/` NEW | The three extra clips with posters; the editor screenshot. |

## Responsive, motion, weight

- Under 900px, on touch devices, and under `prefers-reduced-motion`: the same parts in flow, nothing pinned — the header, a two-column grid of the eight clips (playing), a caption, the editor screenshot flat with its border. No choreography, no pointer response.
- Eight 540px videos loop only while the hero is on screen (paused by an IntersectionObserver). The screenshot is one PNG.

## Acceptance

The world and its parallax visible through the whole hero with no black edge at any scroll position at 1280, 1512 and 2000 wide. The header pinned for the whole 480vh. Cards cluster, spread, drift off; the editor card rises tilted and settles flat, its layers answering the pointer. Nothing in the hero is a rebuilt editor. Typecheck and build clean.
