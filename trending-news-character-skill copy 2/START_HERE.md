# Start Here

Use this file first.

## Human Setup

1. Copy `.env.example` to `.env`.
2. Put in your own:
   - X bearer token
   - HeyGen API key
   - ElevenLabs API key only if you turn on ElevenLabs voice or caption/transcript workflows
   - ElevenLabs voice id only if you use ElevenLabs voice
   - HeyGen avatar look id or talking photo id
3. Edit:
   - `config/project.json`
   - `config/research.json`
   - `config/video.json`
   - `config/platforms.json`
4. Run:

```bash
python3 scripts/setup_check.py
```

5. If setup passes, tell your agent to read:
   - `AGENT_RUNBOOK.md`
   - `SYSTEM.md`

## Minimum Viable Configuration

If you want the fastest path to first output:

- set `research.mode` to `manual_topic`
- set your avatar and voice ids
- if you only have one avatar look, set `avatar_rotation.enabled` to `false`
- if you keep avatar rotation enabled, fill all three `avatar_rotation.avatar_look_ids`
- keep captions disabled
- keep the final layout as Hyperframes on top and HeyGen on bottom
- set your project name and audience
- run one test video from a manually supplied topic

## Required User Decisions

You must decide:

- what your project is called
- what niche or beat you cover
- whether research starts from manual topics, X keywords, or an X list
- what your title style and video layout defaults should be
- what your truth and claims tolerance is

## Do Not Put In The Template

Do not save private values back into the distributed template:

- real API keys
- live user outputs
- exported transcripts
- rendered videos
- your personal research history or narrative notes
