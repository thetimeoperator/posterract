/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import test from "node:test";

import { generate, getAssetSpec, isAssetRef, serializeAssetRef } from "./generate.ts";

/**
 * The same options must hash the same however they were written, and a
 * different prompt or seed must not: that identity is what stops a project
 * from paying to regenerate the same asset every time it opens, and what
 * makes changing a prompt actually produce something new.
 */
async function keyOf(spec: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(spec, Object.keys(spec).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("a declaration is a value, not a call to a provider", () => {
  const ref = generate.image({ prompt: "a red square" });
  assert.ok(isAssetRef(ref));
  assert.equal(getAssetSpec(ref).type, "image");
});

test("option order does not change a declaration's identity", async () => {
  const a = getAssetSpec(generate.image({ prompt: "a red square", seed: 7, aspectRatio: "9:16" }));
  const b = getAssetSpec(generate.image({ aspectRatio: "9:16", seed: 7, prompt: "a red square" }));
  assert.equal(await keyOf({ ...a }), await keyOf({ ...b }));
});

test("a different prompt, or a different seed, is a different asset", async () => {
  const base = await keyOf({ ...getAssetSpec(generate.image({ prompt: "a red square", seed: 1 })) });
  const prompt = await keyOf({ ...getAssetSpec(generate.image({ prompt: "a blue square", seed: 1 })) });
  const seed = await keyOf({ ...getAssetSpec(generate.image({ prompt: "a red square", seed: 2 })) });
  assert.notEqual(base, prompt);
  assert.notEqual(base, seed);
});

test("an empty prompt is refused where it is written, not at generation time", () => {
  assert.throws(() => generate.image({ prompt: "   " }), /non-empty string prompt/);
  assert.throws(() => generate.video({ prompt: "" }), /non-empty string prompt/);
});

test("a declaration with no nested refs serialises for the edit protocol", () => {
  const wire = serializeAssetRef(generate.voice({ prompt: "hello there" }));
  assert.deepEqual(wire, { $generate: { type: "voice", prompt: "hello there" } });
});

test("a declaration built on another does not serialise — only authored code spells it", () => {
  const hero = generate.image({ prompt: "a hero shot" });
  assert.equal(serializeAssetRef(generate.video({ prompt: "pan across it", startFrame: hero })), undefined);
});
