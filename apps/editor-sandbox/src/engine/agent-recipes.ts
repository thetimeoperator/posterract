/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Things worth asking an agent to do with a video.
 *
 * The hardest part of working with an agent is not the connection — it is
 * knowing what to ask for. These are the asks that pay off, written the way
 * they should be sent: naming the tools, saying what "done" looks like, and
 * telling it to check its own work with a capture. A recipe is a starting
 * point, not a macro; the user sends it in the session they already have
 * open, and edits it like any other message.
 */

export interface AgentRecipe {
	id: string;
	label: string;
	/** One line under the label — what it will actually do. */
	hint: string;
	prompt: string;
}

export const AGENT_RECIPES: readonly AgentRecipe[] = [
	{
		id: "silences",
		label: "Cut the silences",
		hint: "Finds the gaps and tightens them",
		prompt:
			"Tighten this video by removing the silences.\n\n" +
			"1. posterract_get_context to see the scene and its clips.\n" +
			"2. posterract_media_waveform on the clip with speech to find the quiet stretches — anything below the noise floor for more than 0.35s.\n" +
			"3. Trim those stretches out with sourceIn/sourceOut, closing the gaps so nothing is left hanging.\n" +
			"4. posterract_validate, then posterract_capture at three points and look at them before telling me it worked.\n\n" +
			"Keep every cut on a word boundary — do not clip the start or end of a word.",
	},
	{
		id: "captions",
		label: "Caption this scene",
		hint: "Transcribes and writes editable lines",
		prompt:
			"Add captions to this scene.\n\n" +
			"1. posterract_media_transcribe on the clip that carries the speech.\n" +
			"2. Add a <captions> element with <cue> children — real lines in the source, not a transcript file — grouped at most 6 words or 2.2s per line, broken at sentence boundaries.\n" +
			"3. Pick a preset that suits the footage and keep the text inside the safe area.\n" +
			"4. posterract_capture over the speech and read the captions in the images to check the timing.",
	},
	{
		id: "hooks",
		label: "Three hook variants",
		hint: "Same video, three different openings",
		prompt:
			"Give me three different openings for this video, as three scenes I can compare.\n\n" +
			"Duplicate the first two seconds into three scenes and make each one a genuinely different hook — a question, a claim, and a visual cold open. Vary the words, the type treatment and the timing, not just the colour.\n\n" +
			"Capture the first second of each and show me the three side by side.",
	},
	{
		id: "reference",
		label: "Match a reference",
		hint: "Rebuild the look of an image you give it",
		prompt:
			"I am going to give you a reference image. Match its look in this scene.\n\n" +
			"Read the reference for its type scale, weight, colour palette, spacing and rhythm, then apply those to what is already here — do not rebuild the content, restyle it.\n\n" +
			"Tell me the specific choices you are copying before you make them, then posterract_capture and compare against the reference.",
	},
	{
		id: "audit",
		label: "Audit the layout",
		hint: "Finds overlaps, clipping and unsafe edges",
		prompt:
			"Check this scene for layout problems.\n\n" +
			"Use posterract_get_geometry at three times across the scene and look for: elements overlapping that should not, text overflowing its box, anything outside the frame, and anything inside the 9:16 unsafe margins where a platform's UI sits.\n\n" +
			"Report what you find as a list with the element ids. Fix only what I confirm.",
	},
] as const;
