# Relative timing and stagger

Two ways to state timing as a relationship rather than a number, so trimming
one thing does not leave every number after it wrong.

## `after`

`after="<id>"` puts an element's span where another element's span ends.

```tsx
<rect id="first" start={0} end="1s" … />
<rect id="second" after="first" … />
```

`second` begins at 1s. Trim `first` to 0.6s and `second` follows, without the
file being touched. `start` alongside `after` becomes the **gap** after the
target rather than a time in the scene:

```tsx
<rect id="third" after="second" start="0.5s" … />
```

It is resolved against the target's *resolved* span, so it is right even when
the duration only arrived when the media loaded. Chains settle within the
frame, so an export — which renders each frame once — encodes the same timing
the preview shows. An `after` naming nothing leaves the element where it is: a
typo does not silently move a shot to zero. Two elements each `after` the
other settle rather than hang.

Every timed element takes it, not only vectors.

## `stagger`

`stagger` on a `<group>` is how far apart its children's motion runs.

```tsx
<group id="cascade" stagger="0.35s">
  <rect id="c1" …><animation type="fade" duration="0.4s" /></rect>
  <rect id="c2" …><animation type="fade" duration="0.4s" /></rect>
  <rect id="c3" …><animation type="fade" duration="0.4s" /></rect>
</group>
```

The nth child reads the clock `n × stagger` behind its siblings, so one
animation authored on each child arrives as a cascade. Nothing is written per
child — the offset is applied when motion is sampled — so the source stays
what you wrote and each child keeps one timeline row.

Nested staggers add: one over rows and another over the cells in a row
cascades in both directions from two numbers.

## `duck`

`<duck>` holds one clip's level down while another one plays — the music under
a voiceover, stated once instead of drawn as a volume track.

```tsx
<scene id="main" width={1080} height={1920}>
  <audio id="music" src="audio/bed.mp3" />
  <audio id="vo" src="audio/voice.mp3" start="2s" />
  <duck target="music" by="vo" amount={-14} attack="0.12s" release="0.5s" />
</scene>
```

`target` gets quieter, `by` drives it. `amount` is in dB and negative. The
envelope **leads** the ducking clip by `attack` — the music is already down
when the first word lands, the way a person rides a fader — holds for the
clip, then recovers over `release`, both ends eased rather than ramping at a
constant rate.

It is derived from the `by` clip's own span, not accumulated as the player
runs, so trimming the voiceover moves the duck with it and scrubbing into the
middle of one shows the level an export writes there. dB is added rather than
multiplied, so a duck composes with the clip's own `volume` and with any
volume keyframe track instead of replacing them. Several ducks on one target
add up.
