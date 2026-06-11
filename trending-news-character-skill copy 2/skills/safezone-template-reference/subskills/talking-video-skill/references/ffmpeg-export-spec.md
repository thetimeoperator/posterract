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

## Composition Rule

- Hyperframes output should be generated in 1:1 format
- place Hyperframes in the top half of the final frame
- place the HeyGen avatar clip in the bottom half of the final frame
- assemble the final video with FFmpeg

## Required Technical Behavior

- keep the video vertical at all times
- preserve the raw HeyGen render
- preserve the Hyperframes output
- export a clean final master with the top and bottom halves aligned correctly

## Notes

- captions are disabled for now
- the current priority is clean top/bottom composition and fast final export
