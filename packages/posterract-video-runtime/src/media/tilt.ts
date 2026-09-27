/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Draws a layer tilted in 3D. The element was drawn flat into the layer; here
 * the layer is turned by a homography (see `utils/tilt`) and composited.
 *
 * Canvas 2D can only draw a picture through an affine transform, and a
 * tilted plane seen through a camera is not affine: its far side is smaller.
 * So the turn happens on the GPU, in one pass that asks, for every pixel of
 * the result, which point of the flat layer lands on it — sampled from a
 * mipmapped copy of the layer, so a plane seen nearly edge-on does not
 * shimmer. Without WebGL2 the picture is drawn through the affine part of
 * the turn: exact with no perspective, flatter than it should be with one.
 */

import { invert3, screenTilt, type Mat3, type TiltAngles } from '../utils/tilt';

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(width: number, height: number): Canvas {
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
void main() {
	gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

// \`back\` takes a pixel of the result to the flat layer, in canvas pixels
// (top-left origin). A positive third coordinate is a point in front of the
// camera; the other solution of the division is a reflection behind it. The
// texture is read in uniform control flow so its mip level is right, then
// dropped where there is nothing to show.
const TILT = `#version 300 es
precision highp float;
uniform sampler2D layer;
uniform vec2 size;
uniform mat3 back;
out vec4 color;
void main() {
	vec2 pixel = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
	vec3 source = back * vec3(pixel, 1.0);
	bool front = source.z > 1e-6;
	vec2 uv = (source.xy / max(source.z, 1e-6)) / size;
	vec4 texel = texture(layer, uv);
	bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
	color = front && inside ? texel : vec4(0.0);
}`;

class GpuTilter {
	private readonly canvas: Canvas;
	private readonly gl: WebGL2RenderingContext;
	private readonly program: WebGLProgram;
	private readonly texture: WebGLTexture;
	private readonly uniforms: { layer: WebGLUniformLocation | null; size: WebGLUniformLocation | null; back: WebGLUniformLocation | null };

	public static create(): GpuTilter | null {
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
			return new GpuTilter(canvas, gl);
		} catch {
			return null;
		}
	}

	private constructor(canvas: Canvas, gl: WebGL2RenderingContext) {
		this.canvas = canvas;
		this.gl = gl;
		this.program = link(gl, VERTEX, TILT);
		this.uniforms = {
			layer: gl.getUniformLocation(this.program, 'layer'),
			size: gl.getUniformLocation(this.program, 'size'),
			back: gl.getUniformLocation(this.program, 'back'),
		};
		this.texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	/** Turns `layer` by `back` (result pixel → layer pixel) and returns the canvas holding the result. */
	public draw(layer: Canvas, back: Mat3): Canvas {
		const gl = this.gl;
		const { width, height } = layer;
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		// Premultiplied, like the canvas it came from, so filtering at an
		// anti-aliased edge does not darken it. The first row stays the first.
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer as TexImageSource);
		gl.generateMipmap(gl.TEXTURE_2D);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(this.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.uniform1i(this.uniforms.layer, 0);
		gl.uniform2f(this.uniforms.size, width, height);
		// GLSL reads matrices column by column.
		gl.uniformMatrix3fv(this.uniforms.back, false, [
			back[0], back[3], back[6],
			back[1], back[4], back[7],
			back[2], back[5], back[8],
		]);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		return this.canvas;
	}
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error(`3D tilt shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
		}
		return shader;
	};
	const handle = gl.createProgram()!;
	gl.attachShader(handle, compile(gl.VERTEX_SHADER, vertexSource));
	gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fragmentSource));
	gl.linkProgram(handle);
	if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
		throw new Error(`3D tilt program failed to link: ${gl.getProgramInfoLog(handle)}`);
	}
	return handle;
}

// One GPU context for every tilt: nested tilts run one after another, each
// finished and composited before the next begins. Undefined until the first
// tilt asks; null where there is no WebGL2.
let tilter: GpuTilter | null | undefined;

/**
 * Composites `layer` onto `target`, tilted: `axes` is the element's own frame
 * in the target's device pixels (its 2D transform's linear part) and `pivot`
 * the point it turns about, on the target. The target keeps its own alpha,
 * blend mode and filter. An element scaled to nothing draws nothing.
 */
export function drawTilted(
	target: Ctx,
	layer: Canvas,
	tilt: TiltAngles,
	axes: readonly [number, number, number, number],
	pivot: { x: number; y: number },
): void {
	if (tilter === undefined) tilter = GpuTilter.create();

	target.save();
	target.setTransform(1, 0, 0, 1, 0, 0);
	if (tilter) {
		const forward = screenTilt(tilt, axes, pivot);
		const back = forward ? invert3(forward) : null;
		if (back) target.drawImage(tilter.draw(layer, back), 0, 0);
	} else {
		// Without perspective the turn is affine, and a canvas can draw it.
		const flat = screenTilt({ ...tilt, perspective: 0 }, axes, pivot);
		if (flat) {
			target.setTransform(flat[0], flat[3], flat[1], flat[4], flat[2], flat[5]);
			target.drawImage(layer, 0, 0);
		}
	}
	target.restore();
}
