---
name: safezone-template-reference
description: Saved template snapshot of the successful Fed/BTC false-dopamine run, preserving the exact safe-zone-first HyperFrames workflow, artifact structure, and QA pattern.
---

# YourCharacter Crypto Character Skill

Use this skill when a creator wants a reusable workflow for a crypto/NFT character.

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
- script validation:
  `{baseDir}/subskills/viral-script-skill/SKILL.md`
- HyperFrames visual generation:
  `{baseDir}/subskills/hyperframes-video-skill/SKILL.md`
- video production:
  `{baseDir}/subskills/talking-video-skill/SKILL.md`

## Contract

The workflow must:

1. respect the configured research mode
2. verify claims before scripting
3. preserve the approved script during render
4. create the talking-head clip first from the approved script
5. generate the HyperFrames top-half clip from the same approved script
6. after both parts are generated, speed up the assembled final video to 1.5x
7. break the approved script into 3 or 4 mini prompts for the HyperFrames top half
7. make each mini prompt correspond directly to the part of the script being spoken in that window
8. use HyperFrames for clean editorial top-half scenes with strong text hierarchy, maps, data cards, dashboards, infographics, and explainer layouts when useful
9. never use homemade placeholder assets, sketch graphics, fake charts, or abstract filler as top-half hero visuals
10. add a centered title to the final video using white text on a black rectangular background with no rounded corners
11. return a final assembled 1080x1920 master
12. never truncate a persistent title
13. never run more than one live provider test in a single run
14. never use paid API keys unless the user explicitly approved that run
15. rotate the 3 configured avatar looks across the 3 daily runs in order
16. once a render run starts, do not abort, replan, or restart the run because you want to review or improve the plan; finish the run and deliver the output first
17. never bypass the established no-overlap layout workflow or substitute a manual shortcut for the spacing system
18. the primary HyperFrames layout truth is the final visible top-half viewport of 1080x960 in the assembled 1080x1920 master, not the full 1080x1080 square source
19. inside that top-half viewport, the mandatory safe zone for HyperFrames assets and infographics is 960x890, centered in the top-half viewport
20. do not cut corners or skip steps at any stage of the workflow: research, scripting, talking-head render, HyperFrames planning, HyperFrames rendering, assembly, and final verification are all mandatory
21. do not move to the next stage until the current stage's required artifact exists and has been checked against the workflow rules
22. every new HyperFrames run must use new scene architecture, new motion treatment, and new asset selection for that script; reusing the previous run's animation/layout structure is forbidden
23. you are not allowed to use old scaffolds from old videos; all HyperFrames clips must be brand new and have new assets and animations for that run
24. HyperFrames top-half composition must work from the bottom up inside one unified 960x890 safe zone in the 1080x960 top-half viewport; do not force every scene into a rigid two-box split, and if separate upper/lower regions are used they must remain flexible, give the lower content enough room, and never clip, overlap, run off, or cut off any content
25. screenshot/photo hook scenes must show the screenshot/photo plainly inside the full 960x890 safe zone with no decorative effects, masking, or cut-off treatment unless the user explicitly asks for it
26. the bottom-half talking avatar must be zoomed proportionally to fit the 1080x960 bottom half; never stretch or compress it
