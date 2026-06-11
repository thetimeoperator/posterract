# FFmpeg Export Spec

Use this file when creating the final publishable master.

## Final Format

The final master must always be:
- 1080x1920
- 9:16 vertical
- 15 to 30 seconds
- top half = Hyperframes visuals
- bottom half = HeyGen avatar clip
- no captions for now
- title lower third = short viral edgy title over the bottom HeyGen avatar section, under the speaker's face

## Composition Rule

- Hyperframes output should be generated in 1:1 format
- place Hyperframes in the top half of the final frame
- place the HeyGen avatar clip in the bottom half of the final frame
- assemble the final video with FFmpeg
- after assembly, add the title as a bottom-section lower third using Helvetica75 Bold, white text, a solid black rectangle, and no rounded corners
- title text must wrap or resize to fit fully inside the video frame with clear padding and readable line spacing inside the black band; no clipped words, no title running off screen, and no text crowded against the frame edges

## Required Technical Behavior

- keep the video vertical at all times
- preserve the raw HeyGen render
- preserve the Hyperframes output
- export a clean final master with the top and bottom halves aligned correctly
- use the user's installed `ffmpeg` and `ffprobe` from PATH by default
- if FFmpeg is installed somewhere unusual, use `config/video.json`, `FFMPEG_PATH`, `FFPROBE_PATH`, `--ffmpeg`, or `--ffprobe` to point the assembly script at it
- when a title is requested, the selected FFmpeg must support `drawtext`; if it does not, stop with a clear install/override message instead of silently exporting without the title

## Notes

- captions are disabled for now
- the current priority is clean top/bottom composition and fast final export
