/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Wakes an engine loop that has gone idle (see `Engine.requestFrame`), for code
 * that changes what the canvas shows without holding the engine — an agent's
 * request arriving over the CLI bridge, say. A window event, so the sender
 * needs no import of the engine.
 */
export const ENGINE_WAKE_EVENT = 'posterract:engine-wake';

export function wakeEngine(): void {
	window.dispatchEvent(new Event(ENGINE_WAKE_EVENT));
}
