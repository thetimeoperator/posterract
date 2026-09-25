/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Solid port of the SiriWave `wave` variant: plain WebGL, one full-screen
// triangle, one fragment shader. Only the shell changed from the original —
// a `let canvas` for the ref, onMount/createEffect/onCleanup for the effects.
//
// The shader is the original with five edits, each marked `// EDIT`: five
// uniforms that can drive it from a real voice instead of its own fake audio.
// With `uLive = 0` and `uAmp = 1` it draws exactly what the original draws.

import { createSignal, mergeProps, onCleanup, onMount, Show, splitProps } from 'solid-js';

import { useExport } from '@/context/export';
import { useLayout } from '@/context/layout';
import { cx } from '@/lib/cva';

import type { JSX } from 'solid-js';

export interface SiriWaveProps extends Omit<JSX.CanvasHTMLAttributes<HTMLCanvasElement>, 'children'> {
	/** CSS px, default 420. */
	width?: number;
	/** CSS px, default 96. The original forced a square; the shader handles any aspect. */
	height?: number;
	/** Default 0.75, as in the original. */
	renderScale?: number;
	/** 0 = the shader's own fake audio (the original look), 1 = driven by `levels`. */
	live?: number;
	/** Multiplies the wave's height; 1 = the original. */
	amp?: number;
	/** Each 0–1. */
	levels?: { low: number; mid: number; high: number };
	paused?: boolean;
}

export const WAVE_VERTEX_SHADER = `attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;

// WAVE_SHADER:BEGIN
export const WAVE_SHADER = `precision highp float;
uniform vec2 iResolution; uniform float iTime;
uniform float uLive; uniform float uLow; uniform float uMid; uniform float uHigh; uniform float uAmp; // EDIT 1: five uniforms
const float PI = 3.14159265359;
const float AMPLITUDE   = 0.32;
const float FREQ        = 1.1;
const float ABER_FREQ   = 1.0;
const float SPEED       = 2.4;
const float WAVE_SCALE  = 0.6;
const float ABERRATION  = 2.6;
const float THICKNESS   = 3.0;
const float INTENSITY   = 2.;
const float FALLOFF     = 1.7;
const float EDGE_MASK   = 0.4;
const float EDGE_INSET  = 0.0;
const float BAND_FILL   = 30000.0;
const float BAND_THICK  = 0.08;
const float SOFTNESS    = 2.5;
const float LOW_AMP     = 6.0;
const float LOW_INT     = 1.5;
const float MID_ABER    = 0.8;
const float MID_ABAMP   = 0.05;
const float MID_BAND    = 20.0;
const float MID_SOFT    = 0.4;
const float HIGH_ABER   = 0.5;
const float HIGH_ABAMP  = 0.06;
const float RESOLVED    = 1.0;
const float UNRES_SCALE = 0.14;

vec3 spectral4(int s){
    float x = float(s);
    return clamp(vec3(abs(x-3.0)-1.0, 2.0-abs(x-2.0), 2.0-abs(x-4.0)), 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 R = iResolution.xy;
    float aspect = R.x / R.y;
    vec2 p = (fragCoord + 0.5) * 2.0 / R - 1.0;
    p.x *= aspect;
    float yScreen = p.y;
    p /= max(WAVE_SCALE, 0.1);

    float t   = iTime;
    float low  = mix(clamp(0.45 + 0.45*sin(t*0.8)*sin(t*0.37+1.0), 0.0, 1.0), uLow,  uLive); // EDIT 2
    float mid  = mix(clamp(0.40 + 0.40*sin(t*1.7+2.0)*sin(t*0.53), 0.0, 1.0), uMid,  uLive); // EDIT 3
    float high = mix(clamp(0.30 + 0.30*sin(t*2.9+4.0)*sin(t*0.71+2.0), 0.0, 1.0), uHigh, uLive); // EDIT 4

    float res   = clamp(RESOLVED, 0.0, 1.0);
    float drift = mod(t, 20.0*PI) * SPEED;

    float xN  = p.x / max(aspect, 1.0);
    float env = cos(PI*0.5 * min(abs(0.9*xN), 1.0));
    env *= env;

    float A1    = AMPLITUDE*uAmp + 0.01*low*LOW_AMP; // EDIT 5: height follows the voice
    float A2    = A1 + mid*MID_ABAMP + high*HIGH_ABAMP;
    float AB    = (ABERRATION + mid*MID_ABER + high*HIGH_ABER)*res;
    float th    = mix(0.1, 0.01*THICKNESS, res);
    float inten = mix(0.1, 0.01*(INTENSITY + low*LOW_INT), res);
    float soft  = 0.01*res*max(0.0, SOFTNESS + mid*MID_SOFT);

    float dUnres = max(length(p) - mix(0.14, UNRES_SCALE, res), 0.0);
    float yMain = A1 * env * res * sin(p.x*FREQ + drift);

    float bandFillTh = max(BAND_THICK, 1e-4);
    float bandAmt    = 1e-4 * BAND_FILL * inten;
    vec3 num = vec3(0.0), den = vec3(0.0);
    for(int s = 0; s < 4; s++){
        vec3 hue = mix(vec3(1.0), spectral4(s), res);
        den += hue;
        float ab = mix(-AB, AB, float(s)/3.0);
        float yL = A2 * env * res * sin(p.x*ABER_FREQ + drift + ab);
        float d   = mix(dUnres, abs(p.y - yL), res);
        float lor = mix(1.0/(1.0 + (0.02*d)*(0.02*d)), 1.0, res);
        float line = inten / (sqrt(d*d + soft*soft) + th);
        float lo = min(yMain, yL), hi = max(yMain, yL);
        float dBand = max(0.0, max(p.y - hi, lo - p.y));
        float band  = bandAmt / (dBand + bandFillTh);
        num += hue * lor * (line + band);
    }
    vec3 col = num / den;

    float dM    = mix(dUnres, abs(p.y - yMain), res);
    float lorM  = mix(1.0/(1.0 + (0.02*dM)*(0.02*dM)), 1.0, res);
    float boost = (1.0 - res) * (14.0*low + 4.0);
    col += 0.5 * inten * (lorM + boost) / (sqrt(dM*dM + soft*soft) + th);

    col = pow(max(col, 0.0), vec3(1.5));
    float emT = clamp((abs(yScreen) - 1.0 + EDGE_INSET) / (-max(EDGE_MASK, 1e-4)), 0.0, 1.0);
    float em  = emT*emT*(3.0 - 2.0*emT);
    float gauss = exp(-pow(xN*FALLOFF, 2.0));
    col *= mix(1.0, em*gauss, res);
    col *= res;
    fragColor = vec4(col, 1.0);
}
void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }
`;
// WAVE_SHADER:END

/**
 * How fast the wave follows a louder voice (a time constant), and how long it
 * takes to settle flat after: three time constants of the release are 95% of
 * the way down, so a release that settles in 250 ms eases with 250 / 3.
 */
const ATTACK_MS = 60;
const RELEASE_MS = 250 / 3;

type Driven = { live: number; low: number; mid: number; high: number; amp: number };

let warned = false;

export function SiriWave(props: SiriWaveProps) {
	const merged = mergeProps({ width: 420, height: 96, renderScale: 0.75, live: 0, amp: 1, paused: false }, props);
	const [local, rest] = splitProps(merged, [
		'width', 'height', 'renderScale', 'live', 'amp', 'levels', 'paused', 'class', 'style',
	]);
	const layout = useLayout();
	const { exporting } = useExport();
	const [failed, setFailed] = createSignal(false);

	let canvas: HTMLCanvasElement | undefined;

	onMount(() => {
		if (!canvas) return;
		const gl = canvas.getContext('webgl');
		if (!gl) {
			fail('WebGL is not available');
			return;
		}

		const shaders: WebGLShader[] = [];
		const compile = (type: number, source: string): WebGLShader => {
			const shader = gl.createShader(type);
			if (!shader) throw new Error('Could not create a shader');
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			shaders.push(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				throw new Error(gl.getShaderInfoLog(shader) ?? 'The shader did not compile');
			}
			return shader;
		};

		let program: WebGLProgram | null = null;
		let buffer: WebGLBuffer | null = null;
		try {
			program = gl.createProgram();
			if (!program) throw new Error('Could not create a program');
			gl.attachShader(program, compile(gl.VERTEX_SHADER, WAVE_VERTEX_SHADER));
			gl.attachShader(program, compile(gl.FRAGMENT_SHADER, WAVE_SHADER));
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(gl.getProgramInfoLog(program) ?? 'The program did not link');
			}
		} catch (error) {
			for (const shader of shaders) gl.deleteShader(shader);
			if (program) gl.deleteProgram(program);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
			fail(error instanceof Error ? error.message : String(error));
			return;
		}

		gl.useProgram(program);
		buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, 'aPos');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const uniform = (name: string) => gl.getUniformLocation(program, name);
		const uResolution = uniform('iResolution');
		const uTime = uniform('iTime');
		const uLive = uniform('uLive');
		const uLow = uniform('uLow');
		const uMid = uniform('uMid');
		const uHigh = uniform('uHigh');
		const uAmp = uniform('uAmp');

		// The drawing buffer follows the element's size, at the pixel ratio: the
		// original ignored it and was soft on a Retina screen.
		const resize = () => {
			if (!canvas) return;
			const ratio = window.devicePixelRatio || 1;
			const scale = local.renderScale * ratio;
			const width = Math.max(1, Math.round(canvas.clientWidth * scale));
			const height = Math.max(1, Math.round(canvas.clientHeight * scale));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();

		const target = (): Driven => ({
			live: local.live,
			low: local.levels?.low ?? 0,
			mid: local.levels?.mid ?? 0,
			high: local.levels?.high ?? 0,
			amp: local.amp,
		});
		const eased: Driven = target();
		// Readable from outside for the voice bar probe, which checks how high the
		// wave actually rises with a voice and how fast it settles.
		(canvas as HTMLCanvasElement & { siriWave?: Driven }).siriWave = eased;

		const start = performance.now();
		let last = start;
		let frame = 0;
		let raf = requestAnimationFrame(function tick(now) {
			raf = requestAnimationFrame(tick);
			const dt = Math.max(0, now - last);
			last = now;

			const goal = target();
			for (const key of Object.keys(eased) as Array<keyof Driven>) {
				const tau = goal[key] > eased[key] ? ATTACK_MS : RELEASE_MS;
				eased[key] += (goal[key] - eased[key]) * (1 - Math.exp(-dt / tau));
			}

			if (local.paused || document.hidden || !layout.uiVisible() || exporting()) return;
			// A resting wave does not need every frame.
			frame += 1;
			if (local.live <= 0.5 && frame % 2 === 1) return;

			gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.uniform1f(uTime, (now - start) / 1000);
			gl.uniform1f(uLive, eased.live);
			gl.uniform1f(uLow, eased.low);
			gl.uniform1f(uMid, eased.mid);
			gl.uniform1f(uHigh, eased.high);
			gl.uniform1f(uAmp, eased.amp);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		});

		onCleanup(() => {
			cancelAnimationFrame(raf);
			observer.disconnect();
			gl.deleteProgram(program);
			for (const shader of shaders) gl.deleteShader(shader);
			gl.deleteBuffer(buffer);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		});
	});

	function fail(message: string): void {
		if (!warned) {
			warned = true;
			console.warn(`[siri-wave] drawing the plain meter instead: ${message}`);
		}
		setFailed(true);
	}

	const meter = () => {
		const levels = local.levels;
		if (!levels) return 0;
		return Math.min(1, Math.max(0, (levels.low + levels.mid + levels.high) / 3));
	};

	return (
		<Show
			when={!failed()}
			fallback={
				<div
					class={cx('posterract-voice-meter', local.class)}
					style={{ width: `${local.width}px`, height: `${local.height}px` }}
				>
					<span style={{ width: `${Math.round(meter() * 100)}%` }} />
				</div>
			}
		>
			<canvas
				ref={canvas}
				class={cx('block rounded-[20px] bg-black', local.class)}
				style={{
					...(typeof local.style === 'object' ? local.style : {}),
					width: `${local.width}px`,
					height: `${local.height}px`,
				}}
				{...rest}
			/>
		</Show>
	);
}
