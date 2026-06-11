# HyperFrames Prompting

Use this file to derive the top-half HyperFrames plan from the approved script.

## Goal

Turn the approved script into a clean editorial HyperFrames scene plan.

The output must:
- reinforce what the avatar is saying
- stay visually readable in the top half only
- use beautiful text hierarchy when it helps explain the beat
- render in 1:1 format
- look like premium informational motion design, not random graphics

## Key Distinction

- **Allowed text:** headlines, labels, map annotations, stat figures, source lines, short explainer callouts, panel titles
- **Banned text:** subtitle-style transcript overlays, lazy word-for-word captions, debug labels, scene names dumped on screen

## Planning Rule

The planning package should describe for each timed scene:
1. the narration beat being covered
2. the editorial goal of the scene
3. the best explainer format for that beat
4. the layout structure and information hierarchy
5. a named layout blueprint
6. a fresh run-level creative direction
7. the visual direction
8. the motion direction across the full beat
9. the required assets before render
10. the forbidden placeholder assets/styles
11. exact start and end timing so the animation changes when the narration changes
12. a verification checklist
13. a layout budget and overflow policy

## Hard Constraints

- no subtitle overlays
- no lower-third transcript text
- no attempt to place the avatar inside the HyperFrames output
- keep the visual focused on the top-half use case
- keep it clean enough to crop or scale into 1080x960
- treat the 1:1 render as a square master with a mandatory centered top-half safe zone of 1000x950
- all primary content must fit inside that 1000x950 safe zone
- centered safe zone does not mean forcing every element into the literal center; preserve hierarchy and composition, but keep the full layout pulled inward from the outer edges
- only background texture, glows, and non-essential decorative elements may live outside the safe zone
- break the script into timed scenes so the visual changes with the narration
- preserve both the master prompt and the scene-by-scene planning package
- HyperFrames is the renderer/compositor, not the bespoke asset generator
- do not use homemade placeholder graphics or assets under any circumstances
- do not use hand-drawn chart lines, rough map sketches, generic rings, or fake icons as hero visuals
- do not render until each beat has verified assets and a scene plan
