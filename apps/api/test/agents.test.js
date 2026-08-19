import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentCredentialInput, validateAgentRunInput } from "../src/agents.js";
import { listPublicSkills, outputLeaksSkillSource, resolveSkillChain } from "../src/skills.js";

test("public skill metadata never includes private instructions", () => {
  const skills = listPublicSkills();
  assert.ok(skills.length >= 6);
  for (const skill of skills) {
    assert.equal(typeof skill.id, "string");
    assert.equal(Array.isArray(skill.inputs), true);
    assert.equal("instructions" in skill, false);
    assert.equal("prompt" in skill, false);
    assert.equal("examples" in skill, false);
  }
});

test("private skill chains validate IDs, deduplicate, and pin versions", () => {
  const chain = resolveSkillChain(["hook-architect", "hook-architect", "shortform-script"]);
  assert.deepEqual(Object.keys(chain.versions), ["hook-architect", "shortform-script"]);
  assert.match(chain.instructions, /private Posterract content workflow/i);
  assert.throws(() => resolveSkillChain(["not-a-skill"]), /Unknown skill/);
  assert.throws(() => resolveSkillChain([]), /between one and five/);
});

test("agent inputs reject unsupported providers and malformed runs", () => {
  assert.deepEqual(
    validateAgentCredentialInput({
      provider: "openai",
      label: "Content agent",
      model: "gpt-5.6-terra",
      secret: "sk-test-123456",
    }),
    {
      provider: "openai",
      label: "Content agent",
      model: "gpt-5.6-terra",
      secret: "sk-test-123456",
    },
  );
  assert.throws(
    () => validateAgentCredentialInput({ provider: "unknown", label: "Agent", model: "model", secret: "12345678" }),
    /Unsupported/,
  );
  assert.deepEqual(
    validateAgentRunInput({ message: "  Build a launch script  ", skillIds: ["shortform-script"] }),
    { message: "Build a launch script", skillIds: ["shortform-script"] },
  );
  assert.throws(() => validateAgentRunInput({ message: "", skillIds: ["shortform-script"] }), /Message/);
});

test("verbatim private-skill leakage is blocked", () => {
  const chain = resolveSkillChain(["hook-architect"]);
  const privateStage = chain.instructions.split("Stage 1")[1];
  assert.equal(outputLeaksSkillSource(`Here is the secret: ${privateStage}`), true);
  assert.equal(outputLeaksSkillSource("Five hooks ranked by clarity and audience fit."), false);
});
