/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tempo and beat detection for a music track.
 *
 * An editor that knows where the beats fall can lay a bar and beat grid over
 * its timeline and snap motion to it. Everything here works on plain mono PCM
 * — the caller decodes — so it gives the same answer in a worker, in a test
 * and in an export, with no Web Audio and no DOM.
 *
 * The method is Ellis's ("Beat Tracking by Dynamic Programming", 2007), kept
 * close to the paper because it is simple and it holds up:
 *
 * 1. An onset strength envelope: how much louder each moment got than the one
 *    before, measured in decibels per mel band and averaged across bands.
 * 2. A tempo: the lag at which that envelope best matches itself, leaned
 *    towards 120 BPM by a broad prior, because a pulse at 70 and one at 140
 *    are equally periodic and listeners mostly tap the one nearer 120.
 * 3. Beats: the sequence of moments that lands on the strongest onsets while
 *    keeping that spacing, found exactly by dynamic programming.
 * 4. A downbeat: the position in the bar whose beats are, on average, struck
 *    hardest in the bass, because the kick and the bass line mark the one.
 */

/** What `detectBeats` found. */
export interface BeatAnalysis {
	/** Tempo in beats per minute, rounded to 0.1; 0 when nothing periodic was found. */
	bpm: number;
	/** Beat times in seconds, ascending. */
	beats: number[];
	/** The time, in seconds, of a first beat of a bar: the first beat in the bar position struck hardest. 0 without beats. */
	downbeat: number;
	/** Beats per bar assumed when choosing the downbeat. */
	meter: number;
	/** 0–1: how periodic the onsets are at the best tempo — reported even when too low to call it one. */
	confidence: number;
}

export interface BeatOptions {
	/** Slowest tempo considered. Default 70. */
	minBpm?: number;
	/** Fastest tempo considered. Default 180. */
	maxBpm?: number;
	/** Beats per bar. Default 4. */
	meter?: number;
}

/** Audio is averaged down to about this rate first; onsets and beats live far below it. */
const ANALYSIS_RATE = 11025;
/** Analysis window and hop, in samples at the analysis rate: ~46 ms windows every ~11.6 ms. */
const FRAME = 512;
const HOP = 128;
/** Mel bands the spectrum is pooled into, the lowest frequency they reach, and where the bass ends. */
const BANDS = 40;
const LOWEST_HZ = 30;
const BASS_HZ = 200;
/** Band levels are floored this far below the loudest one, so silence reads as silence at any gain. */
const RANGE_DB = 80;
/** The bass level is compressed only above this far below the loudest bass. */
const BASS_KNEE_DB = 30;
/** The tempo prior: a log-Gaussian centred here, this many octaves wide. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** How strongly the beat tracker holds its spacing against a tempting off-beat onset. */
const TIGHTNESS = 100;
/**
 * When the envelope has no beat. Noise correlates with itself by chance, and
 * by more the shorter it is — its best peak stays under about 7 / √frames — so
 * a peak must clear that, and 0.15 however long the track.
 */
const MIN_CONFIDENCE = 0.15;
const CHANCE = 7;
/** How many multiples of a candidate period vouch for it. */
const HARMONICS = 4;
/** How far, in seconds of lag, the tempo is refined through the envelope's later repeats. */
const REFINE_SPAN = 12;
/**
 * The window sees an onset before its centre reaches it: the flux jumps as
 * soon as the burst enters the tail of the window. This many analysis samples
 * (about 11 ms) move a frame's centre onto the onset that produced it —
 * measured on clicks, drums and noisy mixes, which it lands within a few ms of.
 */
const LATENCY = 120;

/**
 * Find the tempo, the beats and a downbeat of a music track.
 *
 * `samples` are mono PCM at `sampleRate`. Input with no periodic onsets —
 * silence, noise, a clip shorter than two beats — returns a bpm of 0 and no
 * beats rather than a grid that means nothing. Never throws.
 */
export function detectBeats(samples: Float32Array, sampleRate: number, options: BeatOptions = {}): BeatAnalysis {
	const meter = Math.max(1, Math.round(finite(options.meter, 4)));
	let minBpm = Math.max(1, finite(options.minBpm, 70));
	let maxBpm = Math.max(1, finite(options.maxBpm, 180));
	if (minBpm > maxBpm) [minBpm, maxBpm] = [maxBpm, minBpm];
	const none: BeatAnalysis = { bpm: 0, beats: [], downbeat: 0, meter, confidence: 0 };
	if (!(sampleRate > 0) || !Number.isFinite(sampleRate) || samples.length === 0) return none;

	const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
	const rate = sampleRate / factor;
	const frameRate = rate / HOP;

	const onsets = onsetEnvelope(decimate(samples, factor), frameRate);
	if (!onsets) return none;
	const { envelope, bass } = onsets;

	const tempo = estimateTempo(envelope, frameRate, minBpm, maxBpm);
	if (!tempo) return none;
	const confidence = Math.min(1, Math.max(0, tempo.confidence));
	if (confidence < Math.max(MIN_CONFIDENCE, CHANCE / Math.sqrt(envelope.length))) return { ...none, confidence };

	// A frame's time is its window's centre, moved by the analysis latency;
	// the boxcar in `decimate` delays by half its length, too.
	const secondsPerFrame = (HOP * factor) / sampleRate;
	const origin = ((LATENCY - FRAME / 2) * factor + (factor - 1) / 2) / sampleRate;
	const duration = samples.length / sampleRate;

	const frames = trackBeats(envelope, tempo.period);
	const positions = frames.map((frame) => frame + peakOffset(envelope, frame));
	// A track that starts on sound rises out of the silence before it, and that
	// reads as an onset at 0 whether or not a beat is there. While the first
	// beat's window still reaches back past the start, it counts only if it
	// keeps time with the beat after it.
	if (positions.length > 1 && frames[0]! <= FRAME / HOP && Math.abs(positions[1]! - positions[0]! - tempo.period) > 1.5) {
		frames.shift();
		positions.shift();
	}
	if (frames.length === 0) return { ...none, confidence };
	const beats = positions.map((position) => Math.min(duration, Math.max(0, origin + position * secondsPerFrame)));

	return {
		bpm: Math.round((600 * frameRate) / tempo.period) / 10,
		beats,
		downbeat: beats[downbeatPhase(envelope, bass, frames, meter)]!,
		meter,
		confidence,
	};
}

function finite(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * Average every `factor` samples into one. A boxcar is a crude low-pass, but
 * onsets survive a little aliasing and this keeps the FFTs small. Anything
 * that is not a finite number counts as silence.
 */
function decimate(samples: Float32Array, factor: number): Float32Array {
	const length = Math.floor(samples.length / factor);
	const out = new Float32Array(length);
	for (let i = 0; i < length; i += 1) {
		let sum = 0;
		for (let j = i * factor, end = j + factor; j < end; j += 1) sum += samples[j]!;
		out[i] = Number.isFinite(sum) ? sum / factor : 0;
	}
	return out;
}

/**
 * The onset strength envelope, one value per hop, or null when the signal is
 * silent throughout.
 *
 * Frame `m` covers the analysis samples `[m·HOP − FRAME, m·HOP)`. Before the
 * signal is silence, so an onset in the very first sample still rises out of
 * something; no frame runs past its end, where a track cut off mid-note would
 * read as one last, broadband onset.
 */
function onsetEnvelope(signal: Float32Array, frameRate: number): { envelope: Float64Array; bass: Float64Array } | null {
	const frames = Math.floor(signal.length / HOP) + 1;
	const bins = FRAME / 2 + 1;
	const { cos, sin, reversed } = fftTables(FRAME);
	const filters = melFilters(bins, frameRate * HOP);

	const window = new Float64Array(FRAME);
	for (let n = 0; n < FRAME; n += 1) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FRAME);

	const re = new Float64Array(FRAME);
	const im = new Float64Array(FRAME);
	const levels = new Float32Array(frames * BANDS);
	const read = (m: number, n: number): number => {
		const index = m * HOP - FRAME + n;
		return m < frames && index >= 0 && index < signal.length ? signal[index]! * window[n]! : 0;
	};
	const pool = (m: number, k: number, power: number): void => {
		const band = filters.band[k]!;
		const row = m * BANDS;
		if (band >= 0) levels[row + band] = levels[row + band]! + power * filters.falling[k]!;
		if (band + 1 < BANDS) levels[row + band + 1] = levels[row + band + 1]! + power * filters.rising[k]!;
	};

	// The frames are real, so two share one complex FFT — frame m as the real
	// part, m + 1 as the imaginary — and are separated by symmetry after.
	for (let m = 0; m < frames; m += 2) {
		for (let n = 0; n < FRAME; n += 1) {
			re[n] = read(m, n);
			im[n] = read(m + 1, n);
		}
		fft(re, im, cos, sin, reversed);
		for (let k = 1; k < bins; k += 1) {
			if (filters.band[k]! < -1) continue;
			const zr = re[k]!;
			const zi = im[k]!;
			const wr = re[FRAME - k]!;
			const wi = im[FRAME - k]!;
			pool(m, k, ((zr + wr) ** 2 + (zi - wi) ** 2) / 4);
			if (m + 1 < frames) pool(m + 1, k, ((zi + wi) ** 2 + (zr - wr) ** 2) / 4);
		}
	}
	let loudest = 0;
	for (let i = 0; i < levels.length; i += 1) loudest = Math.max(loudest, levels[i]!);
	if (!(loudest > 0)) return null;

	// The bass level, for the downbeat. Compressed, but only above a knee well
	// below the loudest bass, so how much arrives still counts: a kick outweighs
	// the low rustle of a snare even when both rise out of silence.
	const bass = new Float64Array(frames);
	let loudestBass = 0;
	for (let m = 0; m < frames; m += 1) {
		for (let b = 0; b < filters.bass; b += 1) bass[m] = bass[m]! + levels[m * BANDS + b]!;
		loudestBass = Math.max(loudestBass, bass[m]!);
	}
	const knee = loudestBass * 10 ** (-BASS_KNEE_DB / 10);
	for (let m = 0; m < frames; m += 1) bass[m] = knee > 0 ? Math.log(1 + bass[m]! / knee) : 0;

	const floor = loudest * 10 ** (-RANGE_DB / 10);
	for (let i = 0; i < levels.length; i += 1) levels[i] = 10 * Math.log10(Math.max(levels[i]!, floor));

	// Spectral flux: the rises only, averaged over bands. Falls say nothing
	// about where a beat is.
	const flux = new Float64Array(frames);
	for (let m = 1; m < frames; m += 1) {
		let sum = 0;
		for (let b = 0; b < BANDS; b += 1) {
			const rise = levels[m * BANDS + b]! - levels[(m - 1) * BANDS + b]!;
			if (rise > 0) sum += rise;
		}
		flux[m] = sum / BANDS;
	}

	// Remove the local mean over about a second, so the envelope measures onsets
	// against their surroundings rather than how busy the mix is; smooth a
	// little, so a beat that falls between two frames still correlates; then
	// scale to unit deviation.
	const envelope = smooth(subtractLocalMean(flux, Math.round(frameRate / 2)), 1);
	let energy = 0;
	for (let m = 0; m < frames; m += 1) energy += envelope[m]! * envelope[m]!;
	const deviation = Math.sqrt(energy / frames);
	if (!(deviation > 1e-9)) return null;
	for (let m = 0; m < frames; m += 1) envelope[m] = envelope[m]! / deviation;
	return { envelope, bass };
}

/**
 * Triangular mel filters over the FFT bins, stored sparsely: bin `k` lies on
 * the falling edge of band `band[k]` and the rising edge of band `band[k] + 1`
 * (either may be out of range). Bins outside every band have `band` −2.
 * `bass` counts the bands centred below BASS_HZ.
 */
function melFilters(
	bins: number,
	rate: number,
): { band: Int32Array; rising: Float64Array; falling: Float64Array; bass: number } {
	const mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
	const low = mel(LOWEST_HZ);
	const high = mel(rate / 2);
	const step = (high - low) / (BANDS + 1);
	const bass = Math.min(BANDS, Math.max(1, Math.ceil((mel(BASS_HZ) - low) / step) - 1));

	const band = new Int32Array(bins).fill(-2);
	const rising = new Float64Array(bins);
	const falling = new Float64Array(bins);
	for (let k = 0; k < bins; k += 1) {
		const position = (mel((k * rate) / (2 * (bins - 1))) - low) / step;
		if (position <= 0 || position >= BANDS + 1) continue;
		const segment = Math.floor(position);
		const fraction = position - segment;
		band[k] = segment - 1;
		rising[k] = fraction;
		falling[k] = 1 - fraction;
	}
	return { band, rising, falling, bass };
}

function fftTables(size: number): { cos: Float64Array; sin: Float64Array; reversed: Uint32Array } {
	const cos = new Float64Array(size / 2);
	const sin = new Float64Array(size / 2);
	for (let k = 0; k < size / 2; k += 1) {
		cos[k] = Math.cos((2 * Math.PI * k) / size);
		sin[k] = Math.sin((2 * Math.PI * k) / size);
	}
	const bits = Math.log2(size);
	const reversed = new Uint32Array(size);
	for (let i = 0; i < size; i += 1) {
		let r = 0;
		for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
		reversed[i] = r;
	}
	return { cos, sin, reversed };
}

/** In-place iterative radix-2 FFT; the length must be the power of two the tables were made for. */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array, reversed: Uint32Array): void {
	const n = re.length;
	for (let i = 0; i < n; i += 1) {
		const j = reversed[i]!;
		if (j > i) {
			const r = re[i]!;
			re[i] = re[j]!;
			re[j] = r;
			const s = im[i]!;
			im[i] = im[j]!;
			im[j] = s;
		}
	}
	for (let size = 2; size <= n; size *= 2) {
		const half = size / 2;
		const stride = n / size;
		for (let start = 0; start < n; start += size) {
			for (let k = 0; k < half; k += 1) {
				const wr = cos[k * stride]!;
				const wi = -sin[k * stride]!;
				const a = start + k;
				const b = a + half;
				const tr = re[b]! * wr - im[b]! * wi;
				const ti = re[b]! * wi + im[b]! * wr;
				re[b] = re[a]! - tr;
				im[b] = im[a]! - ti;
				re[a] = re[a]! + tr;
				im[a] = im[a]! + ti;
			}
		}
	}
}

/** `values` minus their mean over `radius` frames either side (fewer at the edges). */
function subtractLocalMean(values: Float64Array, radius: number): Float64Array {
	const n = values.length;
	const prefix = new Float64Array(n + 1);
	for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i]! + values[i]!;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		const from = Math.max(0, i - radius);
		const to = Math.min(n, i + radius + 1);
		out[i] = values[i]! - (prefix[to]! - prefix[from]!) / (to - from);
	}
	return out;
}

/** Gaussian smoothing with a deviation of `sigma` frames. */
function smooth(values: Float64Array, sigma: number): Float64Array {
	const radius = Math.ceil(3 * sigma);
	const kernel = new Float64Array(2 * radius + 1);
	let total = 0;
	for (let i = -radius; i <= radius; i += 1) {
		kernel[i + radius] = Math.exp(-0.5 * (i / sigma) ** 2);
		total += kernel[i + radius]!;
	}
	const n = values.length;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		let sum = 0;
		for (let j = -radius; j <= radius; j += 1) {
			const index = i + j;
			if (index >= 0 && index < n) sum += values[index]! * kernel[j + radius]!;
		}
		out[i] = sum / total;
	}
	return out;
}

/**
 * Normalised autocorrelation for lags 0…`maxLag`: at each lag, the Pearson-style
 * correlation of the envelope with itself shifted, so a perfectly periodic
 * envelope scores 1 at its period however long the lag.
 */
function autocorrelation(values: Float64Array, maxLag: number): Float64Array {
	const n = values.length;
	const squares = new Float64Array(n + 1);
	for (let i = 0; i < n; i += 1) squares[i + 1] = squares[i]! + values[i]! * values[i]!;
	const out = new Float64Array(maxLag + 1);
	for (let lag = 0; lag <= maxLag; lag += 1) {
		let sum = 0;
		for (let i = 0; i + lag < n; i += 1) sum += values[i]! * values[i + lag]!;
		const head = squares[n - lag]!;
		const tail = squares[n]! - squares[lag]!;
		const scale = Math.sqrt(head * tail);
		out[lag] = scale > 0 ? sum / scale : 0;
	}
	return out;
}

/** The peak of the parabola through `values` at `index - 1`, `index`, `index + 1`. */
function parabolicPeak(values: Float64Array, index: number): { position: number; height: number } {
	const a = values[index - 1] ?? values[index]!;
	const b = values[index]!;
	const c = values[index + 1] ?? values[index]!;
	const curvature = a - 2 * b + c;
	if (curvature >= 0) return { position: index, height: b };
	const offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature));
	return { position: index + offset, height: b - 0.25 * (a - c) * offset };
}

/** The highest of `values` within two frames of `position`. */
function strongestNear(values: Float64Array, position: number): number {
	let strongest = -Infinity;
	const to = Math.min(values.length - 1, Math.ceil(position + 2));
	for (let i = Math.max(0, Math.floor(position - 2)); i <= to; i += 1) strongest = Math.max(strongest, values[i]!);
	return strongest;
}

/** How much a listener's ear leans towards a tempo: 1 at 120 BPM, falling off by the octave. */
function prior(bpm: number): number {
	return Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);
}

/**
 * The beat period in frames, and how periodic the envelope is there.
 *
 * Every autocorrelation peak whose tempo lies in range is a candidate, scored
 * by its mean correlation over its first few multiples: a beat repeats at two,
 * three and four beats as well, where a busy sixteenth-note figure, which also
 * correlates at five sixteenths, does not. The prior picks among them, which is
 * also what settles octave errors — a 150 BPM click correlates just as well at
 * 75, and the prior prefers 150. The winner is then refined through its
 * multiples: the peak near k periods pins the period k times more finely than
 * the first one does.
 */
function estimateTempo(
	envelope: Float64Array,
	frameRate: number,
	minBpm: number,
	maxBpm: number,
): { period: number; confidence: number } | null {
	const n = envelope.length;
	const shortest = Math.max(2, Math.ceil((60 * frameRate) / maxBpm));
	// Two whole periods are the least a correlation can be trusted over.
	const longest = Math.min(Math.floor((60 * frameRate) / minBpm), Math.floor(n / 2) - 1);
	if (longest < shortest) return null;

	const maxLag = Math.max(longest + 1, Math.min(Math.floor(n / 2), Math.round(REFINE_SPAN * frameRate)));
	const correlation = autocorrelation(envelope, maxLag);

	let best: { position: number; height: number } | null = null;
	let bestScore = -Infinity;
	for (let lag = shortest; lag <= longest; lag += 1) {
		const value = correlation[lag]!;
		if (!(value > correlation[lag - 1]! && value >= correlation[lag + 1]!)) continue;
		const peak = parabolicPeak(correlation, lag);
		let support = peak.height;
		let count = 1;
		for (let k = 2; k <= HARMONICS && k * peak.position + 2 <= maxLag; k += 1) {
			support += strongestNear(correlation, k * peak.position);
			count += 1;
		}
		const score = (support / count) * prior((60 * frameRate) / peak.position);
		if (score > bestScore) {
			bestScore = score;
			best = peak;
		}
	}
	if (!best || !(best.height > 0)) return null;

	// Least squares through the origin over the peaks near k·period.
	let weighted = best.position;
	let weights = 1;
	let period = best.position;
	for (let k = 2; ; k += 1) {
		const expected = k * period;
		const from = Math.max(1, Math.floor(expected - 2));
		const to = Math.min(maxLag - 1, Math.ceil(expected + 2));
		if (to <= from) break;
		let lag = -1;
		for (let candidate = from; candidate <= to; candidate += 1) {
			const value = correlation[candidate]!;
			if (value > correlation[candidate - 1]! && value >= correlation[candidate + 1]!) {
				if (lag < 0 || value > correlation[lag]!) lag = candidate;
			}
		}
		if (lag < 0) break;
		const peak = parabolicPeak(correlation, lag);
		// Once the repeats have faded into the noise they stop helping.
		if (peak.height < 0.5 * best.height) break;
		weighted += k * peak.position;
		weights += k * k;
		period = weighted / weights;
	}

	return { period, confidence: best.height };
}

/**
 * The beat frames: the sequence that maximises onset strength at its beats
 * minus a penalty for every gap that strays from `period` (squared, in
 * log-ratio, so rushing and dragging by the same proportion cost the same).
 *
 * `score[t]` is the best such sequence ending on a beat at `t`. A sequence
 * only continues when that is worth more than starting afresh, so the leading
 * silence before the music never gets beats of its own.
 */
function trackBeats(envelope: Float64Array, period: number): number[] {
	const n = envelope.length;
	const nearest = Math.max(1, Math.round(period / 2));
	const furthest = Math.max(nearest, Math.round(2 * period));
	const penalty = new Float64Array(furthest + 1);
	for (let gap = nearest; gap <= furthest; gap += 1) penalty[gap] = TIGHTNESS * Math.log(gap / period) ** 2;

	const score = new Float64Array(n);
	const previous = new Int32Array(n).fill(-1);
	let end = 0;
	for (let t = 0; t < n; t += 1) {
		let best = 0;
		let from = -1;
		for (let gap = nearest; gap <= furthest && gap <= t; gap += 1) {
			const candidate = score[t - gap]! - penalty[gap]!;
			if (candidate > best) {
				best = candidate;
				from = t - gap;
			}
		}
		score[t] = envelope[t]! + best;
		previous[t] = from;
		if (score[t]! > score[end]!) end = t;
	}

	const frames: number[] = [];
	for (let t = end; t >= 0; t = previous[t]!) frames.push(t);
	return frames.reverse();
}

/** Where between frames the envelope actually peaks, near a beat frame: −0.5…0.5. */
function peakOffset(envelope: Float64Array, frame: number): number {
	if (frame < 1 || frame + 1 >= envelope.length) return 0;
	const here = envelope[frame]!;
	if (here < envelope[frame - 1]! || here < envelope[frame + 1]!) return 0;
	return parabolicPeak(envelope, frame).position - frame;
}

/**
 * Which beat, counting from the first, opens a bar: the position in the bar
 * whose onsets are strongest on average. The average rather than the sum, so a
 * position that simply occurs once more in the track has no advantage.
 *
 * Strength is how much the bass rises at the beat. The full-band envelope
 * hears a snare as the loudest thing in the bar, and in most pop the snare is
 * on two and four; the kick and the bass line are what land on one. A click
 * accented on one is louder there in the bass too. Only a track with no bass
 * at all falls back to the envelope.
 *
 * A beat whose window reaches back past the start is left out: the file
 * starting is the loudest rise of all, and says nothing about the bar.
 */
function downbeatPhase(envelope: Float64Array, bass: Float64Array, frames: readonly number[], meter: number): number {
	const counted = frames.map((frame, index) => ({ frame, index })).filter(({ frame }) => frame > FRAME / HOP);
	// A kick's low end keeps building for a few frames after its click.
	const rises = counted.map(({ frame }) => {
		let rise = 0;
		for (let t = Math.max(1, frame - 2); t <= Math.min(bass.length - 1, frame + 3); t += 1) {
			rise += Math.max(0, bass[t]! - bass[t - 1]!);
		}
		return rise;
	});
	const strengths = rises.some((rise) => rise > 0) ? rises : counted.map(({ frame }) => envelope[frame]!);

	const totals = new Float64Array(meter);
	const counts = new Float64Array(meter);
	counted.forEach(({ index }, i) => {
		const phase = index % meter;
		totals[phase] = totals[phase]! + strengths[i]!;
		counts[phase] = counts[phase]! + 1;
	});
	let phase = -1;
	for (let p = 0; p < meter; p += 1) {
		if (counts[p] === 0) continue;
		if (phase < 0 || totals[p]! / counts[p]! > totals[phase]! / counts[phase]!) phase = p;
	}
	return Math.max(0, phase);
}
