---
name: hyperframes-video-skill
description: Produce subject-specific, broadcast-quality HyperFrames visuals for the top half of a 1080x1920 split-screen short, keeping primary content inside the centered 960x890 safe zone while preserving strong art direction, narration timing, and editorial clarity.
---

# HyperFrames Video Skill

Use this subskill to create the HyperFrames visual layer for the upper half of a split-screen short-form video.

Read when working:

- `{repoRoot}/config/video.json`
- `{baseDir}/references/hyperframes-prompting.md`
- installed `hyperframes`, `hyperframes-cli`, and `gsap` skills/docs when available

Useful commands:

```bash
python3 {baseDir}/scripts/build_hyperframes_prompt.py --script-file <runtime-script> --duration <seconds> --json-output <planning-package.json> --output <master-prompt.txt>
npx hyperframes lint
npx hyperframes inspect --samples 12
npx hyperframes preview
npx hyperframes render
```

## North Star

Make the top half feel like a finished editorial video package, not a template.

The safe zone is not the art direction. The safe zone is only the collision boundary. Art direction must come from the story.

Examples:

- NBA playoff recap -> sports-broadcast scoreboard package
- Lakers injury status -> playoff medical/status command board
- crypto market update -> trading terminal/newsroom hybrid
- geopolitical update -> intelligence briefing/map board
- celebrity/social story -> tabloid editorial/social-feed package
- startup/product news -> keynote/newsroom launch package

## Fixed Canvas Model

Final assembled video:

- Full short: `1080x1920`
- HyperFrames owns the top half: `1080x960`
- Primary safe zone: centered `960x890` inside the top half
- Background texture, glow, atmosphere, ticker motion, and non-essential decoratives may extend outside the safe zone
- Headlines, charts, maps, cards, labels, source lines, and story-critical graphics must stay inside the safe zone

Do not design against the full square source edge just because the HyperFrames render may be `1080x1080`. The visible design truth is the `1080x960` top-half viewport.

## Production Workflow

1. **Verify The Story**
   Use the research/script subskills or direct browsing when current facts matter. Do not invent injury statuses, market data, quotes, dates, or outcomes.

2. **Write Or Respect The Narration**
   Use the runtime script created for this run. Do not rewrite it during visual planning unless the mode explicitly asks for a script rewrite pass.

3. **Create A Subject-Specific `DESIGN.md`**
   Before writing HTML, define mood, visual world, palette, type, motion language, and what not to do. The design must be specific to the subject, not chosen from a generic dashboard menu.

4. **Map Beats To Time**
   Break the narration into timed beats. If TTS or real voice audio exists, measure the actual duration and retime scenes to that audio. If no audio exists yet, estimate timing but leave a note that final timing must be retuned after narration.

5. **Layout Before Motion**
   Build each scene at its fully readable hero frame first. Use flex/grid containers and stable dimensions. Add GSAP entrances/exits only after the static layout fits.

6. **Design One Bespoke Scene Per Beat**
   Choose the best explainer format for each beat: scoreboard, injury board, source card, market board, map, timeline, stat board, split-screen contrast, social-feed board, or product/news card. The format should come from the story.

7. **Animate Through The Beat**
   Motion should continue subtly for the full beat: ticker movement, line draws, card emphasis, parallax, glow breathing, score pulses, map route reveals, or chart focus shifts. Avoid scenes that freeze after the first second.

8. **Add A Contextual Bottom Ticker**
   Every run needs a moving ticker/news tape that matches the story genre. Use short story-specific labels, source/context phrases, market/team/policy terms, or alert words. The ticker must be glued to the bottom edge of the HyperFrames top-half viewport, directly above the avatar split. Its horizontal edges may extend outside the safe zone, but it must stay visually secondary and must not collide with major content.

9. **Validate**
   Run `npx hyperframes lint`, then `npx hyperframes inspect --samples 12`. Fix errors and real layout warnings before preview/render.

10. **Preview**
   Open the HyperFrames Studio project URL. Use the preview as a visual quality check, not just a technical check.

## Design Rules

- Design for comprehension first; beauty supports the story.
- Use designed editorial text: headlines, labels, stat figures, annotations, source lines, and short callouts.
- Do not use subtitle-style transcript overlays in the HyperFrames layer.
- Native HTML/CSS/SVG information design is encouraged when it is real design, not placeholder art.
- Do not use random rings, decorative networks, fake charts, unlabeled bars, rough map sketches, or generic glowing shapes as hero visuals.
- Include a moving ticker/news tape in every HyperFrames run; ticker text must be contextual to the story, should never become subtitle text or the main explainer copy, and must sit at the bottom of the HyperFrames layer above the avatar split.
- If a beat needs a chart, make a labeled editorial chart or data board.
- If a beat needs a map, use a clean map treatment or verified/sourced map asset; do not sketch geography from memory.
- If a beat needs a photo/screenshot hook, show it plainly inside the safe zone unless the user asks for a stylized treatment.
- Keep scenes subject-specific. Do not reuse an old opener/card/stat-board/conclusion sequence with text swapped.
- If a scene is too dense, simplify copy and reduce panels. Never force cramped content into the safe zone.
- Preserve source lines when facts are time-sensitive or potentially disputed.

## Implementation Rules

- Use HyperFrames HTML/CSS/GSAP as the source of truth.
- Every timed element needs `class="clip"`, `data-start`, `data-duration`, and `data-track-index`.
- Timelines must be `paused: true` and registered in `window.__timelines`.
- Do not use `Math.random()`, `Date.now()`, async timeline construction, or infinite GSAP repeats.
- Use finite repeats calculated for the composition duration.
- Use `data-layout-ignore` or `data-layout-allow-overflow` only for intentional background/decorative overflow, not to hide real content problems.
- Prefer `inspect` over any stale `validate` command; current HyperFrames uses `npx hyperframes inspect`.

## Output Contract

Return the paths or URLs that exist for the run:

- `DESIGN.md`
- master prompt path, if generated
- planning package path, if generated
- HyperFrames project path
- preview URL
- rendered output path, if rendered
- blocked reason, if facts/assets/audio/rendering were unavailable
