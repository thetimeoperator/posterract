import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestValidationError,
  parseCreatePost,
  parseReschedulePost,
  transmissionStatus,
} from "../src/domain.js";
import {
  decryptSecret,
  encryptSecret,
  hashRequest,
} from "../src/security.js";

const artifactId = "89565f6e-f9d3-4e1b-8981-9e4615df5291";

test("post input is normalized without accepting duplicate platforms", () => {
  const parsed = parseCreatePost(
    {
      artifactId,
      caption: "hello",
      hashtags: ["one", "one", "two"],
      platforms: ["instagram", "threads"],
      perPlatform: {
        threads: {
          caption: "Threads caption",
        },
      },
      scheduledFor: "now",
      accountSetId: "00000000-0000-4000-8000-000000000090",
    },
    new Date("2026-08-13T12:00:00.000Z"),
  );
  assert.deepEqual(parsed.hashtags, ["one", "two"]);
  assert.equal(parsed.projections[1].caption, "Threads caption");
  assert.equal(parsed.scheduleMode, "now");
  assert.equal(parsed.accountSetId, "00000000-0000-4000-8000-000000000090");

  assert.throws(
    () =>
      parseCreatePost({
        artifactId,
        caption: "hello",
        platforms: ["instagram", "instagram"],
      }),
    RequestValidationError,
  );

  assert.throws(
    () => parseCreatePost({
      artifactId,
      caption: "hello",
      platforms: ["instagram"],
      accountSetId: "00000000-0000-4000-8000-000000000090",
      accountIds: ["00000000-0000-4000-8000-000000000091"],
    }),
    (error) => error instanceof RequestValidationError && error.code === "ambiguous_account_target",
  );

  assert.throws(
    () =>
      parseCreatePost({
        artifactId,
        caption: "hello",
        platforms: ["youtube"],
      }),
    (error) => error instanceof RequestValidationError && error.code === "invalid_platforms",
  );
});

test("rescheduling accepts a future timestamp and rejects immediate publishing", () => {
  const now = new Date("2026-08-22T18:00:00.000Z");
  assert.equal(
    parseReschedulePost({ scheduledFor: "2026-08-24T18:00:00.000Z" }, now).toISOString(),
    "2026-08-24T18:00:00.000Z",
  );
  assert.throws(
    () => parseReschedulePost({ scheduledFor: "now" }, now),
    (error) => error instanceof RequestValidationError && error.code === "invalid_scheduled_for",
  );
});

test("request hashes are stable across object key order", () => {
  assert.equal(hashRequest({ b: 2, a: 1 }), hashRequest({ a: 1, b: 2 }));
});

test("token encryption is authenticated and reversible", () => {
  const key = "a".repeat(64);
  const encrypted = encryptSecret("secret-token", key);
  assert.notEqual(encrypted.toString("utf8"), "secret-token");
  assert.equal(decryptSecret(encrypted, key), "secret-token");
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptSecret(tampered, key));
});

test("master status distinguishes partial and total failure", () => {
  assert.equal(transmissionStatus(["live", "live"]), "live");
  assert.equal(transmissionStatus(["live", "failed"]), "partial");
  assert.equal(transmissionStatus(["awaiting_user"]), "awaiting_user");
  assert.equal(transmissionStatus(["live", "awaiting_user"]), "awaiting_user");
  assert.equal(transmissionStatus(["awaiting_user", "failed"]), "partial");
  assert.equal(transmissionStatus(["failed", "needs_reauth"]), "failed");
  assert.equal(transmissionStatus(["live", "processing"]), "transmitting");
});

/**
 * The server is the last line of defence on a caption, so its limits have to be
 * the same ones the editor previewed against. They used to be a second copy in
 * `domain.js`; this keeps them honest if the contract moves.
 */
test("caption limits come from the shared platform contract", async () => {
  const { PLATFORM_CAPABILITIES } = await import("@posterract/contract/capabilities");
  const { PUBLISHING_PLATFORM_IDS } = await import("../src/domain.js");

  for (const provider of PUBLISHING_PLATFORM_IDS) {
    const maximum = PLATFORM_CAPABILITIES[provider].captionMaxChars;
    assert.throws(
      () =>
        parseCreatePost({
          artifactId,
          caption: "x".repeat(maximum + 1),
          platforms: [provider],
          accountIds: ["7f1b0d2c-6b0e-4a1c-9c3b-2f0b5e7a1d44"],
        }),
      (error) =>
        error instanceof RequestValidationError && error.code === "caption_too_long",
      `${provider} should refuse a caption over ${maximum} characters`,
    );
  }
});
