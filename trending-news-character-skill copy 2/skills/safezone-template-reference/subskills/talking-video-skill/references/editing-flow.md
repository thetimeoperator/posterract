# Editing Flow

Use this file when finalizing the publishable master after the raw HeyGen render completes.

## Goal

Turn the raw HeyGen talking-head render into the final publishable master.

The final master must be:
- 1080x1920
- 9:16 vertical
- 15 to 30 seconds
- top half = Hyperframes visuals
- bottom half = HeyGen avatar clip
- no captions for now

## Required Sequence

1. render the raw talking-head clip in HeyGen
2. confirm the raw render completed successfully
3. create a separate Hyperframes prompt from the approved script
4. generate the Hyperframes visuals in a 1:1 frame
5. use FFmpeg to place Hyperframes on the top half
6. use FFmpeg to place the HeyGen avatar on the bottom half
7. export the final vertical master
8. run QA on framing, timing, and clean top/bottom composition

## Output Rule

Keep these artifacts:
- raw HeyGen render
- Hyperframes visual output
- final assembled master

The final master is the publishable file.
