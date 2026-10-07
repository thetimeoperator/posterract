/**
 * The card video's sound, synthesized offline so nothing is licensed or
 * downloaded: a whoosh as the card turns, a low hit when the emblem lands and
 * a bright shimmer as the numbers settle.
 */

export type SoundCue = { at: number; kind: "whoosh" | "impact" | "shimmer" | "tick" };

const RATE = 48_000;

export async function renderCardSound(duration: number, cues: SoundCue[]): Promise<AudioBuffer> {
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(duration * RATE), sampleRate: RATE });
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(context.destination);
  const noise = noiseBuffer(context);
  for (const cue of cues) {
    if (cue.kind === "whoosh") whoosh(context, master, noise, cue.at);
    else if (cue.kind === "impact") impact(context, master, noise, cue.at);
    else if (cue.kind === "shimmer") shimmer(context, master, cue.at);
    else tick(context, master, cue.at);
  }
  return context.startRendering();
}

function noiseBuffer(context: BaseAudioContext) {
  const buffer = context.createBuffer(1, RATE * 2, RATE);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** Air rushing past: band-passed noise sweeping up, swelling and fading. */
function whoosh(context: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number) {
  const source = context.createBufferSource();
  source.buffer = noise;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(380, at);
  band.frequency.exponentialRampToValueAtTime(3_800, at + 0.42);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.5, at + 0.24);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
  source.connect(band).connect(gain).connect(out);
  source.start(at, 0, 0.6);
}

/** A low thump with a short crack on top. */
function impact(context: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number) {
  const body = context.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(120, at);
  body.frequency.exponentialRampToValueAtTime(42, at + 0.38);
  const bodyGain = context.createGain();
  bodyGain.gain.setValueAtTime(0.0001, at);
  bodyGain.gain.exponentialRampToValueAtTime(0.95, at + 0.012);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
  body.connect(bodyGain).connect(out);
  body.start(at);
  body.stop(at + 0.65);

  const crack = context.createBufferSource();
  crack.buffer = noise;
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 1_800;
  const crackGain = context.createGain();
  crackGain.gain.setValueAtTime(0.35, at);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  crack.connect(high).connect(crackGain).connect(out);
  crack.start(at, 0.3, 0.12);
}

/** Bright bell partials, a rising arpeggio that rings out. */
function shimmer(context: BaseAudioContext, out: AudioNode, at: number) {
  [1_318.5, 1_760, 2_349.3, 2_637].forEach((frequency, index) => {
    const start = at + index * 0.055;
    const tone = context.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
    tone.connect(gain).connect(out);
    tone.start(start);
    tone.stop(start + 0.95);
  });
}

/** A short digital blip, for a counter landing. */
function tick(context: BaseAudioContext, out: AudioNode, at: number) {
  const tone = context.createOscillator();
  tone.type = "square";
  tone.frequency.value = 2_200;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.05, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  tone.connect(gain).connect(out);
  tone.start(at);
  tone.stop(at + 0.06);
}
