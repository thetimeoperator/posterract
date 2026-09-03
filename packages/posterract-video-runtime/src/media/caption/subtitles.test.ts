/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { formatSubtitles, parseSubtitles } from "./subtitles.ts";

test("cues serialise as SRT", () => {
	const srt = formatSubtitles(
		[{ start: 0.4, end: 1.9, text: "Count the dots" }, { start: 2, end: 4.25, text: "Three plus three" }],
		"srt",
	);
	assert.equal(srt, [
		"1",
		"00:00:00,400 --> 00:00:01,900",
		"Count the dots",
		"",
		"2",
		"00:00:02,000 --> 00:00:04,250",
		"Three plus three",
		"",
	].join("\n"));
});

test("cues serialise as WebVTT, with the header and no numbering", () => {
	const vtt = formatSubtitles([{ start: 61.5, end: 63, text: "Past a minute" }], "vtt");
	assert.equal(vtt, "WEBVTT\n\n00:01:01,500 --> 00:01:03,000\nPast a minute\n".replace(/,/g, "."));
});

test("empty and inverted cues are dropped, and cues are ordered", () => {
	const srt = formatSubtitles(
		[
			{ start: 5, end: 6, text: "second" },
			{ start: 1, end: 2, text: "first" },
			{ start: 3, end: 3, text: "zero length" },
			{ start: 8, end: 9, text: "   " },
		],
		"srt",
	);
	assert.match(srt, /^1\n00:00:01,000/);
	assert.match(srt, /2\n00:00:05,000/);
	assert.equal(srt.includes("zero length"), false);
	assert.equal(srt.includes("8"), false);
});

test("an SRT round-trips through parse and format", () => {
	const original = "1\n00:00:00,400 --> 00:00:01,900\nCount the dots\n\n2\n00:00:02,000 --> 00:00:04,250\nThree plus three\n";
	const transcript = parseSubtitles(original);
	const cues = transcript.map((segment) => ({
		start: segment.words[0]!.start,
		end: segment.words.at(-1)!.end,
		text: segment.text,
	}));
	assert.equal(formatSubtitles(cues, "srt"), original);
});
