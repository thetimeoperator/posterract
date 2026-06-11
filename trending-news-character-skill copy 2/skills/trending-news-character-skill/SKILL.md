---
name: trending-news-character-skill
description: Run a configurable trending-news character workflow from topic selection through verified short script and final assembled 9:16 video with HyperFrames on top and HeyGen on bottom.
---

# Trending News Character Skill

Use this skill when a creator wants a reusable workflow for a trending-news character.

## Inputs

Read:

- `{baseDir}/../../../SYSTEM.md`
- `{baseDir}/../../../AGENT_RUNBOOK.md`
- `{baseDir}/../../../config/project.json`
- `{baseDir}/../../../config/research.json`
- `{baseDir}/../../../config/video.json`
- `{baseDir}/../../../config/platforms.json`

Then choose the right subskill path:

- topic discovery from X:
  `{baseDir}/subskills/viral-research-skill/SKILL.md`
- script writing:
  `{baseDir}/subskills/viral-script-skill/SKILL.md`
- HyperFrames visual generation:
  `{baseDir}/subskills/hyperframes-video-skill/SKILL.md`
- video production:
  `{baseDir}/subskills/talking-video-skill/SKILL.md`

## Contract

The workflow must:

1. respect the configured research mode
2. ground factual claims before scripting when the run depends on current events
3. preserve the runtime script during render
4. create the talking-head clip from the runtime script
5. generate the HyperFrames top-half clip from the same runtime script
6. after both parts are generated, speed up the assembled final video to 1.5x
7. break the runtime script into 3 or 4 mini prompts for the HyperFrames top half
8. make each mini prompt correspond directly to the part of the script being spoken in that window
9. use HyperFrames for clean editorial top-half scenes with strong text hierarchy, maps, data cards, dashboards, infographics, and explainer layouts when useful
10. include a contextual moving news ticker or market tape in every HyperFrames top-half run; it must use story-specific labels, move continuously, stay secondary to the main beat, and be glued to the bottom edge of the HyperFrames top-half viewport directly above the avatar split
11. never use homemade placeholder assets, sketch graphics, fake charts, or abstract filler as top-half hero visuals
12. after assembling the top HyperFrames layer and bottom talking-head layer, add a short viral edgy title as a lower-third overlay over the bottom talking-head section, under the speaker's face, using `Helvetica75 Bold/Helvetica75 Bold.ttf`, white text, a black rectangular background, and no rounded corners; title text must wrap or resize so it never runs off screen and must keep clear padding from the black band edges
13. return a final assembled vertical master using the mode's configured output settings
14. never truncate a persistent title
15. treat Vidtryx run activation as consent to use the configured providers for that mode
16. never add a separate approval checkpoint before required provider calls
17. rotate the 3 configured avatar looks across the 3 daily runs in order
18. once a render run starts, do not abort, replan, or restart the run because you want to review or improve the plan; finish the run and deliver the output first
19. never bypass the established no-overlap layout workflow or substitute a manual shortcut for the spacing system
20. the primary HyperFrames layout truth is the final visible top-half viewport of 1080x960 in the assembled 1080x1920 master, not the full 1080x1080 square source
21. inside that top-half viewport, the mandatory safe zone for HyperFrames assets and infographics is 960x890, centered in the top-half viewport
22. do not cut corners or skip steps at any stage of the workflow: research, scripting, talking-head render, HyperFrames planning, HyperFrames rendering, assembly, and final verification are all mandatory
23. do not move to the next stage until the current stage's required artifact exists and has been checked against the workflow rules
24. every new HyperFrames run must use new scene architecture, new motion treatment, and new asset selection for that script; reusing the previous run's animation/layout structure is forbidden
25. you are not allowed to use old scaffolds from old videos; all HyperFrames clips must be brand new and have new assets and animations for that run
26. HyperFrames top-half composition must work from the bottom up inside one unified 960x890 safe zone in the 1080x960 top-half viewport; do not force every scene into a rigid two-box split, and if separate upper/lower regions are used they must remain flexible, give the lower content enough room, and never clip, overlap, run off, or cut off any content
27. screenshot/photo hook scenes must show the screenshot/photo plainly inside the full 960x890 safe zone with no decorative effects, masking, or cut-off treatment unless the user explicitly asks for it
28. the bottom-half talking avatar must be zoomed proportionally to fit the 1080x960 bottom half; never stretch or compress it
