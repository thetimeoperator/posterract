/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Typing into a text where it stands on the canvas. The canvas cannot take
 * text input, so a <textarea> is laid over the text for the duration, set in
 * the text's own font, size, spacing and colour and turned by the matrix the
 * canvas draws it with, so the words stay exactly where they were. The canvas
 * leaves the text out meanwhile (`TextEditing`), and the HUD puts the field in
 * place every frame (`placeTextInput`), following zoom, pan, rotation and a
 * box that grows as it is typed into.
 *
 * Every keystroke is the edit the side panel's Content field makes
 * (`editor.editText`), so the side panel, the file and the text's box keep up
 * as it is typed; the whole session is one undo step.
 */

import {
	Chars, Color, Computed, FontStyle, Size, TextAlign, TextCache, TextCase, TextEditing, TextStyle,
	RenderSurface, colorToHex, entityWorldMat, multiply2D, store, translate2D,
} from '@posterract/video-runtime';

import { getDocumentEditor } from '../editor';
import { getEditHistory } from '../history';

import type { Entity, World } from 'koota';

const FIELD_CLASS = 'posterract-text-input';

/** What `line-height: normal` comes to for the fonts the editor ships, per px of size. */
const NORMAL_LINE_HEIGHT = 1.21;

const FIELD_STYLE = {
	position: 'absolute',
	left: '0',
	top: '0',
	transformOrigin: '0 0',
	margin: '0',
	padding: '0',
	border: 'none',
	outline: 'none',
	background: 'transparent',
	resize: 'none',
	overflow: 'hidden',
	boxSizing: 'content-box',
	// Grows with what is typed, as the text's own box does.
	fieldSizing: 'content',
	minWidth: '1px',
	// Wraps where the canvas does: between words, never inside one.
	wordBreak: 'normal',
	overflowWrap: 'normal',
	zIndex: '1000',
};

let styled = false;

let mounted: { field: HTMLTextAreaElement; entity: Entity; world: World } | null = null;

/** The text being typed into, for the HUD to place. */
export function getMountedTextInput(): { field: HTMLTextAreaElement; entity: Entity } | null {
	return mounted;
}

/**
 * Opens `entity` (a text) for typing on the canvas, with all of its words
 * selected, so what is typed replaces them.
 */
export function mountTextInput(world: World, entity: Entity): void {
	if (mounted?.entity === entity) {
		mounted.field.focus();
		return;
	}
	unmountTextInput();

	const canvas = world.get(RenderSurface)?.canvas;
	const container = canvas instanceof HTMLCanvasElement ? canvas.parentElement : null;
	if (!container || !entity.isAlive()) return;

	ensureStyles();

	const editor = getDocumentEditor(world);
	const field = document.createElement('textarea');
	field.className = FIELD_CLASS;
	field.value = entity.get(Chars)?.value ?? '';
	field.spellcheck = false;
	field.setAttribute('aria-label', 'Text');
	Object.assign(field.style, FIELD_STYLE);
	// Out of sight until the HUD has put it over the text: transparent rather
	// than hidden, since a hidden field cannot take the focus it opens with.
	field.style.opacity = '0';

	getEditHistory(world).beginGesture();
	entity.add(TextEditing);

	field.addEventListener('input', () => {
		if (entity.isAlive()) editor.editText(entity, field.value);
	});

	field.addEventListener('keydown', (event) => {
		// The canvas shortcuts are listening on the window; typing here is not
		// for them (backspace would delete the element).
		event.stopPropagation();

		// Enter is a new line, as in the text itself; Escape or ⌘/Ctrl-Enter is done.
		if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
			event.preventDefault();
			finish(world, field, entity);
		}
	});

	// Focus moving elsewhere in the window (a click on the canvas or a panel)
	// is done too. The window itself losing focus is not: switching to another
	// app and back leaves the words where they were, still being typed.
	field.addEventListener('blur', () => {
		if (document.hasFocus()) finish(world, field, entity);
	});

	container.appendChild(field);
	mounted = { field, entity, world };
	field.focus();
	field.select();
}

/** Closes the text field, if one is open, keeping what was typed. */
export function unmountTextInput(): void {
	if (mounted) finish(mounted.world, mounted.field, mounted.entity);
}

function finish(world: World, field: HTMLTextAreaElement, entity: Entity): void {
	if (mounted?.field !== field) return;
	mounted = null;
	field.remove();

	if (entity.isAlive()) {
		entity.remove(TextEditing);
		// A text typed down to nothing is gone, as in any design tool, rather
		// than left as an empty box nobody can see or click. Same undo step.
		if (field.value.trim() === '') getDocumentEditor(world).remove([entity]);
	}

	getEditHistory(world).endGesture();
}

/**
 * Puts the field over the text it edits, in the text's current style: run
 * once a frame by the HUD while the field is open. Placed from the text's
 * own layout, so its first line sits where the canvas drew that line.
 */
export function placeTextInput(world: World, resolution: number): void {
	const current = mounted;
	if (!current) return;

	const { field, entity } = current;
	if (!entity.isAlive()) {
		finish(world, field, entity);
		return;
	}

	const eid = entity.id();
	const computed = store(world, Computed);
	const style = store(world, TextStyle);

	const fontSize = style.fontSize[eid] ?? 16;
	const leading = style.leading[eid] ?? 1;
	const textCase = style.textCase[eid] ?? TextCase.ORIGINAL;
	const align = style.textAlign[eid] ?? TextAlign.LEFT;

	// The first laid-out word says where the canvas put the first line: its box
	// height is the line's, and its ascent is measured from the line the text
	// is set on, whichever baseline that is.
	const first = store(world, TextCache).tokens[eid]?.find((line) => line.length > 0)?.[0];
	const glyphHeight = first?.height || fontSize * NORMAL_LINE_HEIGHT;
	const lineHeight = glyphHeight * leading;

	field.style.fontFamily = JSON.stringify(style.fontFamily[eid] || 'Inter');
	field.style.fontSize = `${fontSize}px`;
	field.style.fontWeight = style.fontWeight[eid] ?? '400';
	field.style.fontStyle = style.fontStyle[eid] === FontStyle.ITALIC ? 'italic' : 'normal';
	field.style.letterSpacing = `${style.letterSpacing[eid] ?? 0}px`;
	field.style.lineHeight = `${lineHeight}px`;
	field.style.textAlign = align === TextAlign.CENTER ? 'center' : align === TextAlign.RIGHT ? 'right' : 'left';
	field.style.textTransform = textCase === TextCase.UPPER ? 'uppercase' : textCase === TextCase.LOWER ? 'lowercase' : 'none';

	const color = entity.has(Color) ? colorToHex(computed.color[eid] ?? 0xFFFFFF) : '#FFFFFF';
	field.style.color = color;
	field.style.caretColor = color;

	// A text given a box wraps inside it; one without grows to its words.
	const boxed = entity.has(Size) && (computed.width[eid] ?? 0) > 0;
	field.style.width = boxed ? `${computed.width[eid]}px` : '';
	field.style.whiteSpace = boxed ? 'pre-wrap' : 'pre';

	// The canvas sets a line's glyphs at the top of the line and leaves the
	// leading below; CSS centres them in it. And the canvas measures from the
	// line the text is set on, CSS from the glyphs' top. Both come out here,
	// so the field's first line lands on the canvas's.
	const top = first
		? first.y - first.metrics.fontBoundingBoxAscent - (lineHeight - glyphHeight) / 2
		: 0;

	const mat = multiply2D(entityWorldMat(world, entity), translate2D(0, top));
	const r = resolution || 1;
	field.style.transform = `matrix(${mat.a / r}, ${mat.b / r}, ${mat.c / r}, ${mat.d / r}, ${mat.e / r}, ${mat.f / r})`;
	field.style.opacity = '1';
}

/** The selection colour is a pseudo-element's, which an inline style cannot reach. */
function ensureStyles(): void {
	if (styled) return;
	styled = true;
	const sheet = document.createElement('style');
	sheet.textContent = `.${FIELD_CLASS}::selection { background: rgba(101, 255, 154, 0.35); }`;
	document.head.appendChild(sheet);
}
