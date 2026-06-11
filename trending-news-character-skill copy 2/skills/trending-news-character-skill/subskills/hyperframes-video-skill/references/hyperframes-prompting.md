# HyperFrames Prompting

Use this reference to turn a verified story and narration script into a subject-specific HyperFrames visual plan for the top half of a split-screen short.

## Goal

Produce an upper-half visual package that feels designed for the story:

- clear enough to understand without reading subtitles
- polished enough to feel like a broadcast/editorial package
- constrained to the top-half safe zone
- timed to the narration beats
- visually different from prior runs

Do not let the safe zone create a generic layout. The safe zone protects content; the story creates the look.

## Required Planning Artifacts

For each run, preserve:

1. `DESIGN.md`
2. beat map with start/end/duration
3. scene plan JSON, if generated
4. HyperFrames project files
5. preview URL or rendered output path

## Run-Level Design Prompt

Before scene planning, define the run-level visual world:

- story angle: what the viewer should feel or understand
- genre: sports broadcast, injury board, market terminal, intelligence briefing, tabloid feed, product launch, etc.
- palette: 4-6 colors with roles
- typography: headline/body/data styles
- layout grammar: how cards, charts, maps, timelines, or source panels behave
- ticker strategy: bottom-of-HyperFrames placement, motion direction, phrase style, and how it supports the story without becoming subtitles
- motion language: how scenes stay alive through the beat
- anti-patterns: what this specific story must not look like

Examples:

- NBA recap -> scoreboard package, ticker movement, big abbreviated team cards, broadcast orange/blue
- Lakers injury watch -> medical-status cards, playoff pressure board, gold/purple with OKC-blue horizon
- crypto trend -> market terminal/news desk, volatility pulses, source cards, chart panels
- geopolitics -> briefing map, location labels, source strips, restrained alert color

## Beat Planning Rule

Each timed scene needs:

1. narration beat
2. editorial goal
3. best explainer format for that beat
4. headline and supporting on-screen text
5. safe-zone layout plan
6. subject-specific visual direction
7. motion direction across the full beat
8. required assets or native graphics
9. source/fact notes
10. overflow simplification plan
11. contextual ticker phrase set for the run

## Canvas Constraint

Final assembled canvas:

- full video: `1080x1920`
- top-half viewport: `1080x960`
- primary safe zone: centered `960x890`

Keep all primary information inside the `960x890` safe zone:

- main headline
- stat cards
- charts
- maps
- source cards
- labels
- key images/screenshots
- callouts

Allowed outside safe zone:

- background glows
- texture
- decorative lines
- non-essential particles
- ticker edges
- intentional ambient overflow

## Moving Ticker

Every HyperFrames top-half run needs a contextual moving ticker/news tape.

Rules:

- use short story-specific phrases, source/context terms, market/team/policy labels, or alert words
- keep the ticker secondary to the main beat; it is ambience and editorial texture, not subtitle copy
- let ticker edges extend outside the safe zone only if the text remains readable and does not collide with major content
- place the ticker as a bottom rail glued to the bottom edge of the HyperFrames top-half viewport, directly above the avatar split
- animate continuously through the full scene duration with finite GSAP/CSS motion compatible with HyperFrames rendering

## On-Screen Text

Allowed:

- headlines
- labels
- source lines
- short callouts
- stat figures
- map annotations
- compact explanatory copy

Banned:

- word-for-word subtitles
- full transcript overlays
- debug scene names
- tiny walls of source text
- long paragraphs that only exist because the narration was pasted on screen

## Scene Quality Bar

A good scene:

- explains the beat at a glance
- has one dominant visual idea
- uses hierarchy instead of equal-weight boxes
- contains enough motion to stay alive
- feels native to the story subject
- still reads if the bottom avatar half is cropped beside it later

A weak scene:

- looks like a generic dashboard with new labels
- uses random rings, networks, or bars as fake meaning
- puts the headline and every card in the same old stack every time
- relies on subtitle text to carry the story
- wastes the top half with empty padding

## Timing

If narration audio exists:

1. measure the real audio duration
2. set total HyperFrames duration slightly longer than narration
3. align scene changes to natural sentence/beat boundaries
4. keep final scene on screen after the last words land

If narration audio does not exist:

1. estimate beat durations from word count
2. mark timing as provisional
3. retime after TTS or recorded voice is available

## Validation

Before delivery:

```bash
npx hyperframes lint
npx hyperframes inspect --samples 12
```

Fix actual content overflow. Use `data-layout-ignore` or `data-layout-allow-overflow` only for intentional background/decorative overflow.
