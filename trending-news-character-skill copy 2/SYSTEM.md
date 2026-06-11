# Configured Character System

This folder is the operating system for a configurable short-form video character engine.

## Mission

The system should:
- find the freshest important narrative for the configured niche
- turn that narrative into one strong short-form video
- repeat this flow 3 times per day

Each video should be:
- 15 to 30 seconds
- 1080x1920
- 9:16 vertical
- built for virality and account growth

## Research Flow

1. check X and relevant niche sources for the top narratives
2. search X for the configured keywords
3. only consider:
   - posts from the last 6 to 8 hours
   - original posts only
   - no retweets
   - no replies
   - no comment reading at all
4. rank by engagement as the fallback signal
5. review at most the configured post cap per run
6. keep X usage under the configured budget cap
7. choose one top narrative for the run

## Narrative Selection Rule

Choose the single narrative with the strongest mix of:
- virality
- practical relevance
- attention flow
- audience consequence

The agent should use judgment to decide which narrative matters most and would make the strongest short-form post.

## Consequence Step

After choosing the top narrative:
- check the relevant source material, timeline, data, and audience impact
- include a concrete consequence if one exists
- if there is no useful consequence, skip that part

## Script Step

Write the script using the configured script directives.

The script must be:
- sharp
- short
- useful
- strong enough for a 15 to 30 second video
- allowed to express a clear point of view

Do not run a separate script validator as a mandatory workflow step. The script step should use taste, configured voice, and source context directly instead of blocking production on rigid validator rules.

## Video Build

The final video layout must be:
- top half: Hyperframes visuals
- bottom half: HeyGen talking avatar

## Avatar Rotation

There are 3 daily avatar looks.

- run 1 uses avatar look 1
- run 2 uses avatar look 2
- run 3 uses avatar look 3

Configured avatar look order:
- look 1: first configured `avatar_rotation.avatar_look_ids` value
- look 2: second configured `avatar_rotation.avatar_look_ids` value
- look 3: third configured `avatar_rotation.avatar_look_ids` value

The skill should treat this as a daily 3-run cycle.
Do not reuse the same avatar look across all 3 runs unless the user explicitly changes the rule.

### Bottom Half
- use HeyGen API
- use the configured avatar
- use the configured HeyGen voice ID
- reuse the same configured HeyGen voice ID across all 3 daily avatar looks unless the user explicitly changes that rule
- render the talking-head clip for the bottom half

### Top Half
- use Hyperframes
- create a separate Hyperframes prompt from the script
- break the script into timed visual beats
- generate graphics and animations that visually show what the avatar is saying at each part of the narration
- do not render debug text, prompt text, or scene labels into the top half
- generate the Hyperframes output in a 1:1 frame so it can sit cleanly at the top of the final vertical video

## Final Assembly

Use FFmpeg to assemble the final master:
- 1080x1920
- 9:16 vertical
- top half = Hyperframes output
- bottom half = HeyGen avatar clip

## Captions

Do not add captions for now.
Captions are disabled for the current version of the system.

## Core Rules

- Focus on one top narrative per run, not three at once.
- The goal is freshness.
- The system should optimize for virality, clarity, and growth.
- Workflow compliance is mandatory and outranks speed, convenience, or cheap shortcuts.
- Do not cut corners or skip steps in research, scripting, talking-head generation, HyperFrames planning/rendering, assembly, or final verification.
- Research can be adjusted later only after the current run completes the full required workflow.
- The main thing that must work now is narrative -> script -> HeyGen -> Hyperframes -> FFmpeg final video, with each stage completed and checked before moving on.
- Activating a Vidtryx run is consent to use the configured providers for that mode.
- Do not add a separate approval checkpoint before provider calls.
- Do not run extra live provider tests that are not needed for the selected mode.
- For the 3 daily runs, rotate the avatar looks in order 1 -> 2 -> 3.
