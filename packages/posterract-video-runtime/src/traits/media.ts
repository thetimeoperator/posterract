/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import type { ShaderHost } from '../media/shader';
import type { ImageDecoder } from '../media/image';
import type { VideoDecoderInstance } from '../media/video';
import type { LottiePlayer } from '../media/lottie';
import type { AudioDecoder } from '../media/audio';
import type { CaptionDecoder } from '../media/caption/types';
import type { Waveform } from '../media/audio-peaks';
import type { AudioBus } from '../media/audio-bus';

// Renderer-runtime state on mounted entities (never serialized).
export type MountData = {
	props: Record<string, unknown>;
	textBox?: DocumentFragment;
};

// Handle traits store live runtime instances (decoders, buses, etc.) and are
// never serialized. They use AoS storage: entity.get(X) returns the instance
// directly.

export const ShaderHostHandle = trait(() => null as ShaderHost | null);

export const ImageDecoderHandle = trait(() => null as ImageDecoder | null);

export const VideoDecoderHandle = trait(() => null as VideoDecoderInstance | null);

export const AudioDecoderHandle = trait(() => null as AudioDecoder | null);

export const WaveformHandle = trait(() => null as Waveform | null);

export const CaptionDecoderHandle = trait(() => null as CaptionDecoder | null);

export const AudioBusHandle = trait(() => null as AudioBus | null);

export const Data = trait(() => null as MountData | null);

/**
 * A Lottie animation on a node.
 *
 * `speed` scales the animation's own clock; `loop` repeats it for the
 * element's whole span instead of holding the last frame. The player itself
 * is held separately (`LottieHandle`) because it owns GPU resources and must
 * be disposed with the entity.
 */
export const Lottie = trait({ speed: 1, loop: false });

/** One named, editable value inside a Lottie file. */
/**
 * One editable value inside a Lottie animation.
 *
 * Scalars and colours live in `value` (a colour packed the same way `Color`
 * packs one) so a keyframe track can drive them like any other number; text
 * slots keep their string in `text`, which nothing interpolates. `isColor`
 * says which of the two families `value` belongs to, for builds of Skottie
 * that cannot report a slot's type themselves.
 */
export const LottieSlot = trait({ name: '', value: 0, text: '', isColor: false });

/** The live player for a `<lottie>`; owns GPU resources, disposed with the entity. */
export const LottieHandle = trait(() => null as LottiePlayer | null);
