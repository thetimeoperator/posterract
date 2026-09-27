/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Blends several renders of one canvas into their average — how a frame with
 * motion blur is made: the scene is drawn at a handful of moments inside the
 * shutter, and what the camera would have seen is the mean of them.
 *
 * The blend happens on the GPU in half-float, in premultiplied alpha, so an
 * edge that is covered in three samples out of eight comes out three-eighths
 * opaque — the transparent parts of a trail are right, not just the colours.
 * Without WebGL2 (or without float render targets) it falls back to a running
 * average on a 2D canvas: exact for opaque frames, slightly too opaque on
 * transparent ones.
 */

type Source = HTMLCanvasElement | OffscreenCanvas;
type Target = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FrameAccumulator {
	/** Starts a frame of this size; whatever the last one held is dropped. */
	begin(width: number, height: number): void;
	/** Adds one sample. The weights of a frame should add up to 1. */
	add(source: Source, weight: number): void;
	/** Replaces everything on `target`'s canvas with the blend. */
	resolveInto(target: Target): void;
	dispose(): void;
}

function makeCanvas(width: number, height: number): Source {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return new OffscreenCanvas(width, height);
}

const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 uv;
void main() {
	vec2 corner = corners[gl_VertexID];
	uv = corner * 0.5 + 0.5;
	gl_Position = vec4(corner, 0.0, 1.0);
}`;

// Uploads keep the canvas's first row as the texture's first row, and the
// accumulate pass writes it back row for row; the resolve pass is where the
// picture is turned right way up for the default framebuffer.
const ACCUMULATE = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform float weight;
in vec2 uv;
out vec4 color;
void main() {
	color = texture(source, uv) * weight;
}`;

const RESOLVE = `#version 300 es
precision highp float;
uniform sampler2D sum;
in vec2 uv;
out vec4 color;
void main() {
	color = texture(sum, vec2(uv.x, 1.0 - uv.y));
}`;

class GpuAccumulator implements FrameAccumulator {
	private readonly canvas: Source;
	private readonly gl: WebGL2RenderingContext;
	private readonly accumulate: WebGLProgram;
	private readonly resolve: WebGLProgram;
	private readonly sourceTexture: WebGLTexture;
	private readonly sumTexture: WebGLTexture;
	private readonly framebuffer: WebGLFramebuffer;
	private width = 0;
	private height = 0;

	public static create(): GpuAccumulator | null {
		try {
			const canvas = makeCanvas(1, 1);
			const gl = canvas.getContext('webgl2', {
				alpha: true,
				premultipliedAlpha: true,
				preserveDrawingBuffer: true,
				antialias: false,
				depth: false,
				stencil: false,
			}) as WebGL2RenderingContext | null;
			if (!gl) return null;
			if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
			return new GpuAccumulator(canvas, gl);
		} catch {
			return null;
		}
	}

	private constructor(canvas: Source, gl: WebGL2RenderingContext) {
		this.canvas = canvas;
		this.gl = gl;
		this.accumulate = program(gl, VERTEX, ACCUMULATE);
		this.resolve = program(gl, VERTEX, RESOLVE);
		this.sourceTexture = texture(gl);
		this.sumTexture = texture(gl);
		this.framebuffer = gl.createFramebuffer()!;
	}

	public begin(width: number, height: number): void {
		const gl = this.gl;
		if (width !== this.width || height !== this.height) {
			this.width = width;
			this.height = height;
			this.canvas.width = width;
			this.canvas.height = height;
			gl.bindTexture(gl.TEXTURE_2D, this.sumTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sumTexture, 0);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	public add(source: Source, weight: number): void {
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.viewport(0, 0, this.width, this.height);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.useProgram(this.accumulate);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		gl.uniform1i(gl.getUniformLocation(this.accumulate, 'source'), 0);
		gl.uniform1f(gl.getUniformLocation(this.accumulate, 'weight'), weight);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.disable(gl.BLEND);
	}

	public resolveInto(target: Target): void {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.width, this.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(this.resolve);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.sumTexture);
		gl.uniform1i(gl.getUniformLocation(this.resolve, 'sum'), 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		copyInto(target, this.canvas);
	}

	public dispose(): void {
		const gl = this.gl;
		gl.deleteTexture(this.sourceTexture);
		gl.deleteTexture(this.sumTexture);
		gl.deleteFramebuffer(this.framebuffer);
		gl.deleteProgram(this.accumulate);
		gl.deleteProgram(this.resolve);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}

class CanvasAccumulator implements FrameAccumulator {
	private readonly canvas: Source;
	private readonly ctx: Target;
	private total = 0;

	public constructor() {
		this.canvas = makeCanvas(1, 1);
		this.ctx = this.canvas.getContext('2d') as Target;
	}

	public begin(width: number, height: number): void {
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, width, height);
		this.total = 0;
	}

	// A running mean: the kth sample is laid over the mean of the ones before
	// it at the share of the total it adds, so a pixel that never changes
	// never drifts from its value.
	public add(source: Source, weight: number): void {
		if (weight <= 0) return;
		this.total += weight;
		const ctx = this.ctx;
		ctx.save();
		ctx.globalCompositeOperation = this.total === weight ? 'copy' : 'source-over';
		ctx.globalAlpha = weight / this.total;
		ctx.drawImage(source, 0, 0);
		ctx.restore();
	}

	public resolveInto(target: Target): void {
		copyInto(target, this.canvas);
	}

	public dispose(): void {
		this.canvas.width = 1;
		this.canvas.height = 1;
	}
}

function copyInto(target: Target, source: Source): void {
	target.save();
	target.setTransform(1, 0, 0, 1, 0, 0);
	target.globalCompositeOperation = 'copy';
	target.globalAlpha = 1;
	target.filter = 'none';
	target.drawImage(source, 0, 0, target.canvas.width, target.canvas.height);
	target.restore();
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
	const handle = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, handle);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return handle;
}

function program(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error(`Motion blur shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
		}
		return shader;
	};
	const handle = gl.createProgram()!;
	gl.attachShader(handle, compile(gl.VERTEX_SHADER, vertexSource));
	gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fragmentSource));
	gl.linkProgram(handle);
	if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
		throw new Error(`Motion blur program failed to link: ${gl.getProgramInfoLog(handle)}`);
	}
	return handle;
}

/** The GPU accumulator where the platform has one, the 2D running mean otherwise. */
export function createFrameAccumulator(): FrameAccumulator {
	return GpuAccumulator.create() ?? new CanvasAccumulator();
}
