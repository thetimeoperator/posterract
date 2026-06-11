# Caption Spec

Use this file when burning captions into the final video.

## Rendering Method

Use FFmpeg's `subtitles` filter with ASS styling.

Do not rely on raw `drawtext` for long captions.

## Required Font

Use this font by default:

- `{baseDir}/../assets/fonts/caption-font.otf`

Pass the font directory through `fontsdir` so libass can resolve it.

## Safe-Zone Rule

Captions must sit in the lower-third safe zone by default.

That means:

- centered horizontally
- padded from the left edge
- padded from the right edge
- padded from the top edge
- never cut off
- never allowed to extend beyond the readable width of the frame

## Layout Rule

Caption text must be wrapped into neat line groups before it can overflow the frame.

Use ASS subtitle rendering so the text can stay inside a constrained, centered caption block instead of one oversized line.

Persistent top titles must preserve the full text.

That means:

- never silently truncate a title because it crossed a soft word or character target
- wrap the title into additional lines when necessary
- if the wrapped title is still too large, reduce title styling before dropping words
- an overlong full title is acceptable; a cut-off title is not

## Styling Direction

The technical system should support these ASS style fields:

- `FontName`
- `FontSize`
- `Alignment`
- `MarginL`
- `MarginR`
- `MarginV`
- `Outline`
- `Shadow`
- `PrimaryColour`

The recommended default alignment for lower-third centered captions is bottom-center.

## FFmpeg Rule

Use:

- `fontsdir` for the custom font directory
- `force_style` for ASS style overrides
- `wrap_unicode=1` when supported by the FFmpeg/libass build

`wrap_unicode` improves line breaking behavior, but the subtitle asset still needs to be authored cleanly.

## QA Rule

Reject the edit if:

- any line runs off-screen
- any line touches the edge too closely
- the subtitle block sits too low or too high
- the captions feel visually uneven across the clip
