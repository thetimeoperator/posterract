/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { detectBeats } from "./beats.ts";

const RATE = 22050;

/** A seeded uniform source, so the noisy tests hear the same noise every run. */
function uniform(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Seeded white Gaussian noise. */
function gaussian(seed: number): () => number {
	const next = uniform(seed);
	return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

/**
 * A metronome: a 1 kHz burst dying away over ~10 ms on every beat, the first
 * at `start`. Every `accentEvery`th click, counting from the first, is
 * `accent` times louder.
 */
function clickTrack(
	bpm: number,
	{ seconds = 14, start = 0.5, accent = 1, accentEvery = 4, rate = RATE } = {},
): { samples: Float32Array; clicks: number[] } {
	const samples = new Float32Array(Math.round(seconds * rate));
	const clicks: number[] = [];
	for (let k = 0; start + (k * 60) / bpm < seconds; k += 1) {
		const time = start + (k * 60) / bpm;
		clicks.push(time);
		const gain = k % accentEvery === 0 ? accent : 1;
		const first = Math.ceil(time * rate);
		const last = Math.min(samples.length, first + Math.round(0.05 * rate));
		for (let i = first; i < last; i += 1) {
			const t = i / rate - time;
			samples[i] = samples[i]! + 0.5 * gain * Math.exp(-t / 0.01) * Math.sin(2 * Math.PI * 1000 * t);
		}
	}
	return { samples, clicks };
}

/** `samples` plus white noise `snr` dB below their mean power. */
function withNoise(samples: Float32Array, snr: number, seed = 11): Float32Array {
	let power = 0;
	for (const value of samples) power += value * value;
	const deviation = Math.sqrt(power / samples.length / 10 ** (snr / 10));
	const noise = gaussian(seed);
	return samples.map((value) => value + deviation * noise());
}

/** The share of `beats` within `tolerance` seconds of one of `clicks`. */
function onClicks(beats: readonly number[], clicks: readonly number[], tolerance = 0.02): number {
	const hits = beats.filter((beat) => clicks.some((click) => Math.abs(beat - click) <= tolerance));
	return beats.length ? hits.length / beats.length : 0;
}

for (const bpm of [128, 90, 150]) {
	test(`a click track at ${bpm} BPM gives its tempo, and beats on its clicks`, () => {
		const { samples, clicks } = clickTrack(bpm);
		const result = detectBeats(samples, RATE);
		assert.ok(Math.abs(result.bpm - bpm) <= 1, `bpm ${result.bpm}`);
		assert.ok(onClicks(result.beats, clicks) >= 0.9, "nearly every beat is on a click");
		assert.ok(result.beats.length >= 0.9 * clicks.length, "and nearly every click has a beat");
		assert.ok(result.confidence > 0.5, `confidence ${result.confidence}`);
		assert.ok(result.beats.every((beat, i) => i === 0 || beat > result.beats[i - 1]!), "in ascending order");
	});
}

test("a beat lands within 15 ms of its click: the analysis latency is taken out", () => {
	const { samples, clicks } = clickTrack(128);
	assert.equal(onClicks(detectBeats(samples, RATE).beats, clicks, 0.015), 1);
});

test("the downbeat is the first beat of the bar's loudest position", () => {
	const { samples, clicks } = clickTrack(128, { start: 0.5, accent: 2 });
	const result = detectBeats(samples, RATE);
	const accented = clicks.filter((_, k) => k % 4 === 0);
	assert.equal(result.meter, 4);
	assert.ok(accented.some((time) => Math.abs(result.downbeat - time) <= 0.02), `downbeat ${result.downbeat}`);
	assert.ok(result.beats.includes(result.downbeat), "and it is one of the beats");
});

test("the meter says how many beats make a bar", () => {
	const { samples, clicks } = clickTrack(100, { accent: 2, accentEvery: 3 });
	const result = detectBeats(samples, RATE, { meter: 3 });
	assert.equal(result.meter, 3);
	const accented = clicks.filter((_, k) => k % 3 === 0);
	assert.ok(accented.some((time) => Math.abs(result.downbeat - time) <= 0.02), `downbeat ${result.downbeat}`);
});

test("the downbeat follows the kick, not the louder snare on the backbeat", () => {
	// Kick on one and three, a bright snare on two and four: the snare has
	// the bigger onset, the kick is where the bar starts.
	const bpm = 100;
	const samples = new Float32Array(14 * RATE);
	const noise = gaussian(5);
	const kicks: number[] = [];
	for (let k = 0; 0.4 + (k * 60) / bpm < 14; k += 1) {
		const time = 0.4 + (k * 60) / bpm;
		const kick = k % 2 === 0;
		if (kick) kicks.push(time);
		const first = Math.ceil(time * RATE);
		const last = Math.min(samples.length, first + Math.round(0.3 * RATE));
		for (let i = first; i < last; i += 1) {
			const t = i / RATE - time;
			const sound = kick
				? 0.8 * Math.min(1, t / 0.002) * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (50 * t + 3 * (1 - Math.exp(-t / 0.03))))
				: 0.6 * Math.exp(-t / 0.06) * noise();
			samples[i] = samples[i]! + sound;
		}
	}
	const result = detectBeats(samples, RATE);
	assert.equal(result.bpm, bpm);
	assert.ok(kicks.some((time) => Math.abs(result.downbeat - time) <= 0.02), `downbeat ${result.downbeat}`);
});

test("beats start where the music does, not where the file does", () => {
	const { samples, clicks } = clickTrack(128, { start: 0.3 });
	const result = detectBeats(samples, RATE);
	assert.ok(Math.abs(result.beats[0]! - 0.3) <= 0.02, `first beat ${result.beats[0]}`);
	assert.ok(onClicks(result.beats, clicks) >= 0.9);
});

test("a track that starts on the beat has a beat at zero", () => {
	const { samples } = clickTrack(120, { start: 0 });
	const result = detectBeats(samples, RATE);
	assert.ok(result.beats[0]! <= 0.02, `first beat ${result.beats[0]}`);
});

test("the tempo holds through noise at 6 dB SNR", () => {
	const { samples, clicks } = clickTrack(128);
	const result = detectBeats(withNoise(samples, 6), RATE);
	assert.ok(Math.abs(result.bpm - 128) <= 2, `bpm ${result.bpm}`);
	assert.ok(onClicks(result.beats, clicks) >= 0.9);
	// The noise starts with the file, and that rise out of silence is not a beat.
	assert.ok(result.beats[0]! > 0.45, `first beat ${result.beats[0]}`);
});

test("level and sample rate do not change the answer", () => {
	const { samples, clicks } = clickTrack(128, { seconds: 12 });
	const loud = detectBeats(samples, RATE);
	const quiet = detectBeats(samples.map((value) => value * 0.01), RATE);
	assert.equal(quiet.bpm, loud.bpm);
	assert.equal(quiet.beats.length, loud.beats.length);
	assert.ok(quiet.beats.every((beat, i) => Math.abs(beat - loud.beats[i]!) < 0.001));

	const cd = detectBeats(clickTrack(128, { seconds: 12, rate: 44100 }).samples, 44100);
	assert.equal(cd.bpm, 128);
	assert.ok(onClicks(cd.beats, clicks) >= 0.9);
});

test("silence has no tempo and no beats", () => {
	const result = detectBeats(new Float32Array(12 * RATE), RATE);
	assert.equal(result.bpm, 0);
	assert.deepEqual(result.beats, []);
	assert.equal(result.downbeat, 0);
	assert.ok(result.confidence < 0.2);
});

test("noise alone has no beat to find", () => {
	const noise = gaussian(3);
	const result = detectBeats(new Float32Array(12 * RATE).map(() => 0.2 * noise()), RATE);
	assert.equal(result.bpm, 0);
	assert.deepEqual(result.beats, []);
	assert.ok(result.confidence < 0.2, `confidence ${result.confidence}`);
});

test("a clip too short for a tempo comes back empty rather than throwing", () => {
	const { samples } = clickTrack(128, { seconds: 0.5, start: 0.1 });
	for (const input of [samples, new Float32Array(0), new Float32Array(10)]) {
		const result = detectBeats(input, RATE);
		assert.equal(result.bpm, 0);
		assert.deepEqual(result.beats, []);
	}
	assert.equal(detectBeats(samples, 0).bpm, 0);
});
