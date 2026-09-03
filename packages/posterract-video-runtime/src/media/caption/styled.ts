/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Presets described rather than written.
 *
 * The first seven caption styles are each their own decoder, because each does
 * something structurally different. Most styles are not like that: they differ
 * in how a line is broken, how much of it is on screen at once, and what
 * happens to the word currently being said. Those three choices are what this
 * decoder takes as a description — so a new style is a dozen lines of intent
 * instead of a hundred lines of the same machinery.
 */

import { CaptionAlign, CaptionType, PaintType } from '../../constants';
import { Caption, Color, Paint, TextRange, TextStyle } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { store } from '../../world/store';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { clearTextRanges, findActiveGroup, groupBy, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';

import type { Entity, World } from 'koota';
import type { Asset, WordGroup } from '@posterract/video-assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';
import type { WebFonts } from '../../fonts/fixtures';

/** What happens to the word currently being said. */
export type CaptionEmphasis =
	/** Nothing — the whole line reads the same. */
	| 'none'
	/** It takes the accent colour. */
	| 'color'
	/** It takes the accent colour and grows. */
	| 'pop'
	/** Everything up to and including it is coloured: a karaoke fill. */
	| 'fill'
	/** It sits on a filled block. */
	| 'box';

/** How much of a line is on screen. */
export type CaptionReveal =
	/** The whole line, for its whole window. */
	| 'line'
	/** One word at a time. */
	| 'word'
	/** The line arriving a word at a time and staying. */
	| 'typewriter';

export interface CaptionStyleSpec {
	readonly type: CaptionType;
	/** Narrowed to the bundled faces: a preset must ship with its font. */
	readonly style: CaptionPresetStyle & { fontFamily: keyof typeof WebFonts };
	readonly width: number;
	readonly height: number;
	readonly align: CaptionAlign;
	/** How lines are broken: by how long they last, or how long they are. */
	readonly group: { duration: number } | { length: number };
	readonly emphasis: CaptionEmphasis;
	readonly reveal: CaptionReveal;
	/** The accent every emphasis but `none` paints with. */
	readonly accent: number;
	/** The line's own colour, drawn beneath any paint the file adds. */
	readonly base: number;
	/** How much bigger the said word gets under `pop`. 1 is no change. */
	readonly popScale?: number;
}

export class StyledCaptionDecoder implements CaptionDecoder {
	public readonly type: CaptionType;
	public groups: WordGroup[] = [];
	public ready = false;
	public readonly whenReady: Promise<void>;
	public styled = false;

	private readonly asset: Asset;
	private readonly spec: CaptionStyleSpec;
	/** The ranges and fills the current frame's emphasis is made of. */
	private accents: Entity[] = [];
	private groupIndex = -1;
	private wordIndex = -1;

	public constructor(spec: CaptionStyleSpec, asset: Asset) {
		this.spec = spec;
		this.type = spec.type;
		this.asset = asset;
		this.whenReady = this.init();
	}

	private async init(): Promise<void> {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, this.spec.group);
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, {
			width: this.spec.width,
			height: this.spec.height,
			defaultAlign: this.spec.align,
		});
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;
		loadWebFont(world, this.spec.style.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			this.clear(world, entity);
			return;
		}

		const group = this.groups[groupIndex]!;
		const wordIndex = group.findIndex((word) => relativeTime >= word.start && relativeTime <= word.end);
		if (groupIndex === this.groupIndex && wordIndex === this.wordIndex) return;

		this.groupIndex = groupIndex;
		this.wordIndex = wordIndex;

		// What is on screen depends on the reveal; the word being said is
		// still tracked either way, because that is what emphasis needs.
		const visible = this.spec.reveal === 'word'
			? (wordIndex === -1 ? [] : [group[wordIndex]!])
			: this.spec.reveal === 'typewriter'
				? group.slice(0, wordIndex === -1 ? group.length : wordIndex + 1)
				: group;

		setChars(world, entity, visible.map((word) => word.text).join(' '));
		clearTextRanges(world, entity);
		this.accents = [];

		if (this.spec.emphasis === 'none' || wordIndex === -1 || visible.length <= 1) return;

		// Where the said word sits in the text actually drawn.
		const index = this.spec.reveal === 'typewriter' || this.spec.reveal === 'line' ? wordIndex : 0;
		if (index >= visible.length) return;

		const before = visible.slice(0, index).map((word) => word.text).join(' ');
		const start = this.spec.emphasis === 'fill' ? 0 : before.length ? before.length + 1 : 0;
		const end = visible.slice(0, index + 1).map((word) => word.text).join(' ').length;
		if (end <= start) return;

		this.accents = [this.accent(world, entity, start, end)];
	}

	/**
	 * A coloured range over `[start, end)`, plus whatever else the emphasis
	 * asks for. Ranges are how per-run styling reaches the text renderer, so
	 * a scale or a box is the same mechanism as a colour.
	 */
	private accent(world: World, entity: Entity, start: number, end: number): Entity {
		const range = createEntity(world);
		range.add(TextRange);
		range.set(TextRange, { start, end });
		appendChild(world, range, entity);

		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: this.spec.accent });
		appendChild(world, fill, range);

		if (this.spec.emphasis === 'pop') {
			// A bigger size on the range: the word grows in place, and the
			// line reflows around it the way it would if it were set that way.
			range.add(TextStyle);
			range.set(TextStyle, {
				fontSize: Math.round(this.spec.style.fontSize * (this.spec.popScale ?? 1.18)),
			});
		}

		return fill;
	}

	private clear(world: World, entity: Entity): void {
		setChars(world, entity, '');
		clearTextRanges(world, entity);
		this.accents = [];
		this.groupIndex = -1;
		this.wordIndex = -1;
	}

	public draw(world: World, entity: Entity): void {
		// The file's first colour slot overrides the accent, so a preset can be
		// recoloured without becoming a different preset.
		const accent = entity.get(Caption)?.colors?.[0] ?? this.spec.accent;
		const colors = store(world, Color);
		for (const fill of this.accents) colors.value[fill.id()] = accent;

		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.accents = [];
		this.groupIndex = -1;
		this.wordIndex = -1;
	}
}
