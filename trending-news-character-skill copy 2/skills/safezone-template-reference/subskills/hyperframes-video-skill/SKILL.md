---
name: hyperframes-video-skill
description: Plan and build clean editorial HyperFrames scenes for the top half of the final 9:16 video using beat-level prompts, real assets, and beautiful visual hierarchy.
---

# Hyperframes Video Skill

Read:

- `{baseDir}/../../../../../config/video.json`
- `{baseDir}/references/hyperframes-prompting.md`
- `/tmp/hyperframes_repo/skills/hyperframes/SKILL.md`
- `/tmp/hyperframes_repo/AGENTS.md`

Use:

```bash
python3 {baseDir}/scripts/build_hyperframes_prompt.py --script-file <approved-script> --duration <seconds> --json-output <planning-package.json> --output <master-prompt.txt>
npx hyperframes lint
npx hyperframes validate
npx hyperframes render
```

## Core Principle

Use HyperFrames the way it is meant to be used: as a clean HTML/CSS/GSAP composition system for beautiful editorial motion design.

The top half should look like:
- premium explainer slides
- annotated maps
- stat cards
- market dashboards
- clean infographics
- elegant text hierarchy
- polished scene transitions

The top half must **not** look like:
- random abstract filler
- placeholder vectors
- homemade sketches
- unlabeled doodle charts
- generic rings, lines, or shapes pretending to be information design

## Rules

- do not rewrite the approved script
- break the script into timed beats and build one deliberate scene plan per beat
- each beat must decide the best explainer format: map card, editorial slide, data board, annotated hero image, stat board, split-screen explainer, or other clean information-design format
- designed text is allowed and encouraged when it improves comprehension: headlines, labels, stat figures, map annotations, source lines, short callouts, and panel titles
- lazy subtitle-style overlays are banned
- every scene must contain explicit layout direction, visual direction, motion direction, required assets, forbidden assets, a named layout blueprint, and a verification checklist
- every new run must invent a fresh creative direction inside the same clean layout system; do not reuse the exact prior visual style, arrangement, scene architecture, animation pattern, treatment, or old scaffold from any old video with only text swaps
- you are not allowed to use old scaffolds from old videos
- all HyperFrames clips must be brand new for that run and must contain new assets, new animation treatment, and new scene architecture appropriate to that script
- every new run must generate new HyperFrames scenes, new motion structure, and new asset selections appropriate to that script; reusing the same opener/gallery/stat-board/network/conclusion sequence from a prior run is forbidden
- style variation must come from native HyperFrames design choices such as palette, typography, grid split, card architecture, annotation treatment, map treatment, chart treatment, motion language, and beat structure
- prefer native HTML/CSS/SVG information design over reliance on external assets; the system should be able to generate clean original infographic-style scenes without needing external media
- generate new clips from a branded template system only; do not reuse or patch old rendered output templates from prior runs
- primary scene layout must come from reusable brand-frame components and blueprint primitives, not freeform absolute-positioned major content blocks
- if a scene is too dense for the safe zone, automatically simplify the scene and render anyway; do not abort the run
- HyperFrames is the renderer and compositor, not the bespoke asset generator
- do not claim prompt text alone generated the visuals
- no scene may render unless its required assets have been generated or sourced and verified
- under no circumstances generate homemade placeholder hero graphics or assets
- under no circumstances use rough map sketches, fake line charts, scribbled arrows, generic glowing rings, or simplistic SVG stand-ins as hero content
- if a beat needs a market scene, design a clean editorial market board with labeled panels and hierarchy; do not draw random curves and call it a chart
- if a beat needs a map scene, use a verified or properly designed map treatment with clean annotations; do not sketch a map from scratch as a placeholder
- compose each beat as a real HyperFrames scene or subcomposition with clean layout first, then motion
- motion must continue through the full beat; scenes cannot stall after the opening animation
- use HyperFrames catalog blocks/components for polish, transitions, and reusable UI patterns when useful, but never as a substitute for beat-specific narrative assets
- run the real CLI flow: `npx hyperframes lint` then `npx hyperframes validate` then `npx hyperframes render`
- if real HyperFrames rendering is not actually available, stop and say that plainly instead of faking it
- once a HyperFrames render run starts, do not abort it to review the plan, rethink scene structure, improve prompts, or edit the skill; finish the run and deliver the clip first
- no mid-run replanning or mid-run restarts unless there is a hard technical failure that makes the render literally impossible to complete
- the primary layout truth for HyperFrames is the final visible top-half viewport of 1080x960 in the assembled 1080x1920 master
- HyperFrames may still render from a 1:1 square source, but composition decisions must be made against the 1080x960 top-half viewport, not against the full 1080x1080 square
- inside that 1080x960 top-half viewport, the mandatory safe zone for HyperFrames assets and infographics is 960x890, centered within the top-half viewport
- all primary HyperFrames assets, infographics, charts, maps, and animations must fit inside that 960x890 safe zone; only background texture, glows, and non-essential decoratives may live outside it
- do not force every HyperFrames scene into a permanent top-half/bottom-half split inside the safe zone
- the 960x890 safe zone is one unified composition area; use the whole safe zone when the scene needs it
- when a scene benefits from separated regions, you may use an upper asset region and a lower message region, but they are flexible layout guides, not fixed equal or rigid containers
- the lower message region must be large enough for all text, stats, cards, and components to fit cleanly without clipping, running off, or being cut off
- the upper asset region must not waste space on weak filler graphics or oversized empty margins; if the top visual is weak, simplify or replace it
- compose from the bottom up inside the 1080x960 top-half viewport: place the most important content low in the safe zone first, then organize supporting visuals above it without starving the lower content of space
- no primary content may sit low enough to touch or visually crowd the avatar seam
- no overlap, no clipping, no running off the frame, and no cut-off components are allowed anywhere in the safe zone; if a scene cannot fit cleanly, simplify it rather than forcing it into a split layout
- do not design scenes top-first; top-heavy layouts that push the important content upward are a workflow violation
- for screenshot/photo hook scenes, place the screenshot or photo cleanly inside the 960x890 safe zone and show it plainly
- do not crop, cut off, mask, stylize, zoom-pulse, or add decorative effects over a screenshot/photo hook unless the user explicitly asks for that treatment
- do not compose major cards, headlines, maps, charts, labels, or stat blocks against the outer edges of the square source just because the source render is 1080x1080; the composition truth is the 1080x960 viewport with a 960x890 safe zone
- do not replace the established layout flow with manual shortcuts or ad hoc freeform composition just because it seems faster
- when safe-zone, viewport, or container rules change in docs/config, you must also inspect the real implementation path that generates the planning package and scene layout (for example `scripts/build_hyperframes_prompt.py` and the actual HyperFrames HTML/CSS) before rendering; do not assume the code picked up the rule just because the skill/config text was updated
- before shipping, verify the generated planning package, project files, and rendered clip reflect the active safe zone dimensions and container system; if the planning artifact or composition still shows old dimensions or old inset behavior, treat the run as invalid and regenerate
- preserve the planning package, asset inventory, HyperFrames project files, and final rendered asset path

## Output Contract

Return:
- master prompt path
- planning package path
- asset inventory path
- HyperFrames project path
- rendered HyperFrames output path
- any blocked reason if required assets or validation are missing
