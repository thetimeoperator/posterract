---
name: talking-video-skill
description: Render a HeyGen talking-head clip from the runtime script, assemble it with a separately generated HyperFrames top-half visual, then speed up the final assembled 9:16 master with FFmpeg.
---

# Talking Video Skill

Read:

- `{baseDir}/../../../../../config/video.json`
- `{baseDir}/references/heygen-api.md`
- `{baseDir}/references/editing-flow.md`
- `{baseDir}/references/ffmpeg-export-spec.md`
- `{baseDir}/references/editing-qa.md`

Use:

```bash
set -a && . {baseDir}/../../../../../.env && set +a
python3 {baseDir}/scripts/heygen_video.py preflight
python3 {baseDir}/scripts/heygen_video.py render --run-slot <1|2|3> ...
python3 {baseDir}/scripts/assemble_vertical_video.py --top-media <hyperframes-output> --bottom-media <heygen-render> --output <final-master> --title "<lower-third-title>"
ffmpeg -y -i <final-master> -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac <final-master-1p5x>
```

Rules:

- do not rewrite the runtime script
- source the project `.env` before running HeyGen commands; the helper reads API keys from environment variables and does not auto-load the file
- run `heygen_video.py preflight` first to confirm quota/API access before the single allowed live provider render
- create the talking-head asset from the runtime script
- use `heygen_video.py render` to create the bottom-half talking-head asset
- after the HyperFrames top-half clip and assembled final master both exist, speed up the final assembled video to 1.5x; do not speed up the talking-head clip by itself
- do not generate HyperFrames assets in this subskill
- accept a separately generated HyperFrames asset for the top half
- keep HyperFrames output in 1:1 so it fits cleanly at the top of the final vertical video
- assemble the final 1080x1920 master with FFmpeg
- add a short viral edgy title after assembly as a lower-third overlay over the bottom talking-head section, under the speaker's face
- use `Helvetica75 Bold/Helvetica75 Bold.ttf` for the title, with white text on a solid black rectangular background and no rounded corners
- title text must wrap or resize to stay fully inside the frame; keep clear padding and readable line spacing inside the black band, and never export a title that runs off screen, gets clipped, or sits too close to the frame edges
- use `assemble_vertical_video.py --title`; it uses the user's installed `ffmpeg`/`ffprobe` from PATH by default and renders the title directly with FFmpeg `drawtext` from the Helvetica75 Bold font file
- if FFmpeg is installed somewhere unusual, use `config/video.json`, `FFMPEG_PATH`, `FFPROBE_PATH`, `--ffmpeg`, or `--ffprobe`; do not hardcode machine-specific paths into the skill template
- the bottom-half layout truth is 1080x960 inside the final 1080x1920 master
- crop and scale the raw HeyGen render so the avatar fills that full 1080x960 bottom half cleanly
- always zoom to fit the AI talking avatar proportionally into the 1080x960 bottom half
- never vertically compress, squash, stretch, or otherwise distort the talking-photo/talking-head asset to make it fit
- for bottom-half avatar framing, use zoom-and-crop from the active image area; remove black padding, scale proportionally, and crop to fit the 1080x960 bottom half rather than distorting the face or body
- do not add captions for now
- never truncate a manual title
- use the run slot to select the correct daily avatar look from config/video.json
- run slot 1 = first configured look, run slot 2 = second configured look, run slot 3 = third configured look
- keep one HeyGen voice ID shared across those looks unless the user explicitly overrides it
- after assembly, extract a few frames or a contact sheet from the final output and visually verify that the lower-third title is readable, sits under the face in the talking-head section, and does not cover the top HyperFrames layer
