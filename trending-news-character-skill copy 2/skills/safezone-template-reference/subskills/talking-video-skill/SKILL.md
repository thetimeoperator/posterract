---
name: talking-video-skill
description: Render a HeyGen talking-head clip from the approved script first, speed it to 1.5x, then assemble it with a separately generated HyperFrames top-half visual into a final 9:16 master with FFmpeg.
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
set -a && source {baseDir}/../../../../../.env && set +a
python3 {baseDir}/scripts/heygen_video.py preflight
python3 {baseDir}/scripts/heygen_video.py render --run-slot <1|2|3> ...
python3 {baseDir}/scripts/assemble_vertical_video.py --top-media <hyperframes-output> --bottom-media <heygen-render> --output <final-master>
ffmpeg -y -i <final-master> -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac <final-master-1p5x>
```

Rules:

- do not rewrite the approved script
- source the project `.env` before running HeyGen commands; the helper reads API keys from environment variables and does not auto-load the file
- run `heygen_video.py preflight` first to confirm quota/API access before the single allowed live provider render
- create the talking-head asset first from the approved script
- use `heygen_video.py render` to create the bottom-half talking-head asset
- after the HyperFrames top-half clip and assembled final master both exist, speed up the final assembled video to 1.5x; do not speed up the talking-head clip by itself
- do not generate HyperFrames assets in this subskill
- accept a separately generated HyperFrames asset for the top half
- keep HyperFrames output in 1:1 so it fits cleanly at the top of the final vertical video
- assemble the final 1080x1920 master with FFmpeg
- add a centered title to the final video using white text on a black rectangular background with no rounded corners
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
- after assembly, extract a few frames or a contact sheet from the final output and visually verify that the title band is readable and the top/bottom halves align cleanly
