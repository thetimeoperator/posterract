# Codex Install Prompt

Paste this prompt into a fresh Codex thread when you want an AI agent to install and configure this skill package for a user.

```text
You are installing and configuring a local Codex skill package called `trending-news-character-skill`.

Skill package folder:
<PASTE_ABSOLUTE_PATH_TO_THIS_FOLDER_HERE>

Your job:
1. Open the package folder and verify these files exist:
   - README.md
   - START_HERE.md
   - SYSTEM.md
   - AGENT_RUNBOOK.md
   - config/project.json
   - config/research.json
   - config/video.json
   - .env.example
   - skills/trending-news-character-skill/SKILL.md
   - skills/trending-news-character-skill/subskills/hyperframes-video-skill/SKILL.md
   - skills/trending-news-character-skill/subskills/talking-video-skill/SKILL.md
   - skills/trending-news-character-skill/subskills/viral-research-skill/SKILL.md
   - skills/trending-news-character-skill/subskills/viral-script-skill/SKILL.md
   - skills/safezone-template-reference/

2. Do not delete, rename, or rewrite `skills/safezone-template-reference/`. It is a protected reference skill tree.

3. Treat this as a project-local Codex skill package. The main skill is:
   `skills/trending-news-character-skill/SKILL.md`

   Important: do not blindly copy only that skill folder into `~/.codex/skills`, because its instructions read shared config and brand files from this package root. Keep the whole folder together unless you intentionally rewrite all relative paths.

4. Read, in this order:
   - README.md
   - START_HERE.md
   - SYSTEM.md
   - AGENT_RUNBOOK.md
   - skills/trending-news-character-skill/SKILL.md
   - config/project.json
   - config/research.json
   - config/video.json

5. Set up secrets locally:
   - If `.env` does not exist, copy `.env.example` to `.env`.
   - Ask the user to provide or paste the required values into `.env`.
   - Do not print secrets back to the user.
   - Do not commit, upload, or redistribute `.env`.

6. Required provider values:
   - `HEYGEN_API_KEY`
   - `HEYGEN_VOICE_ID`
   - at least one usable avatar source:
     - `HEYGEN_AVATAR_ID`, or
     - `HEYGEN_TALKING_PHOTO_ID`, or
     - `HEYGEN_AVATAR_LOOK_ID`
   - if avatar rotation stays enabled, fill all three values in `config/video.json` under `avatar_rotation.avatar_look_ids`
   - if the user only has one avatar, set `avatar_rotation.enabled` to `false`

7. Optional provider values:
   - `X_BEARER_TOKEN` only if `config/research.json` mode is `x_keywords` or `x_list`
   - `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` only if the user intentionally enables ElevenLabs voice or caption/transcript helper flows

8. Configure the project:
   - Edit `config/project.json` with the user's character name, page/channel name, audience, and timezone.
   - Edit `config/research.json` for either manual topics or X discovery.
   - Edit `config/video.json` for avatar IDs, voice IDs, layout settings, and avatar rotation.
   - Keep `captions_enabled` false unless the user explicitly wants the optional caption pipeline.

9. Run the setup check:
   ```bash
   python3 scripts/setup_check.py
   ```

10. If setup is blocked, explain exactly which values are missing and ask the user for only those values. Keep iterating until setup passes.

11. If X discovery is enabled, dry-run the X scanner before making live API calls:
   ```bash
   python3 skills/trending-news-character-skill/subskills/viral-research-skill/scripts/x_recent_scan.py --dry-run --pretty
   ```

12. Explain the production pipeline to the user:
   - choose one narrative
   - verify claims and consequence
   - write the short script
   - render HeyGen talking-head for the bottom half
   - plan/render HyperFrames top-half visuals
   - respect the `1080x960` top viewport and centered `960x890` safe zone
   - assemble top and bottom halves with FFmpeg into `1080x1920`
   - speed up the final assembled master to `1.5x`
   - return all artifact paths

13. Safe-zone rules:
   - final video is two containers: top `1080x960` HyperFrames and bottom `1080x960` HeyGen
   - HyperFrames may render as `1:1`, but design decisions must use the final visible top-half viewport
   - all primary top-half content must stay inside the centered `960x890` safe zone
   - the safe zone is one unified area, not a permanent rigid two-box split
   - upper/lower regions inside the safe zone are allowed only as flexible layout guides
   - no clipping, overlap, cut-off text, or crowding the avatar seam

14. When the user asks for a video run, follow `AGENT_RUNBOOK.md` and the main `SKILL.md` exactly. Treat starting the Vidtryx run as consent to use the providers configured for that mode; do not add a separate approval checkpoint before required provider calls.
```
