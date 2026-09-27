# Motion graphics

A bar of kinetic type on a 128 BPM grid: a red iris fills the frame, the
words slam in a letter at a time, and the camera rushes through them into the
next bar. Everything moves on the beat and every moving number is a timeline
row. Read `references/motion-design.md` for the rules this follows.

```tsx
/** @jsxImportSource @posterract/composition */
export default function Film() {
  return (
    <stage id="workspace">
      <scene id="main" width={1920} height={1080} fill="#111214" bpm={128} motionBlur>
        {/* Bar 1: a dot, then the iris that becomes bar 2's background. */}
        <ellipse id="iris" x={940} y={520} width={40} height={40} fill="#e8453c" start="3.35b" end="4b">
          <keyframeTrack property="scale">
            <keyframe time="0b" value={0} easing="cubicBezier(0.7,0,0.84,0)" />
            <keyframe time="0.65b" value={64} />
          </keyframeTrack>
        </ellipse>

        {/* Bar 2: type that slams in, then the rush into bar 3. */}
        <group id="bar2" start="4b" end="8b">
          <rect id="red" width={1920} height={1080} fill="#e8453c" />
          <group id="type">
            <rect id="type-frame" width={1920} height={1080} />
            <text id="every" x={214} y={310} fontFamily="Montserrat" fontWeight={900} fontSize={190} color="#111214" start="0.1b">
              EVERY
              <textAnimator by="letter" stagger={0.035}>
                <keyframeTrack property="offsetY">
                  <keyframe time="0b" value={150} easing="snappy" />
                  <keyframe time="0.7b" value={0} />
                </keyframeTrack>
                <keyframeTrack property="opacity">
                  <keyframe time="0b" value={0} />
                  <keyframe time="0.2b" value={1} />
                </keyframeTrack>
              </textAnimator>
            </text>
            <keyframeTrack property="scale">
              <keyframe time="0b" value={1} />
              <keyframe time="3.2b" value={1.06} easing="cubicBezier(0.7,0,0.84,0)" />
              <keyframe time="4b" value={9} />
            </keyframeTrack>
          </group>
        </group>

        <effect type="grain" value={0.1} />
        <effect type="vignette" value={0.22} />
      </scene>
    </stage>
  );
}
```

Capture each beat that changes something (`posterract capture` at `1b`, `2b`,
the last frames of the rush) and look at the images: blur and grain only show
in a rendered frame.
