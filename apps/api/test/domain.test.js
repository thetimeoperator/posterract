import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestValidationError,
  parseCreatePost,
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
      platforms: ["instagram", "youtube"],
      perPlatform: {
        youtube: {
          caption: "YouTube description",
          options: { title: "Video title", privacyStatus: "private" },
        },
      },
      scheduledFor: "now",
    },
    new Date("2026-08-13T12:00:00.000Z"),
  );
  assert.deepEqual(parsed.hashtags, ["one", "two"]);
  assert.equal(parsed.projections[1].caption, "YouTube description");
  assert.equal(parsed.scheduleMode, "now");

  assert.throws(
    () =>
      parseCreatePost({
        artifactId,
        caption: "hello",
        platforms: ["instagram", "instagram"],
      }),
    RequestValidationError,
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
  assert.equal(transmissionStatus(["failed", "needs_reauth"]), "failed");
  assert.equal(transmissionStatus(["live", "processing"]), "transmitting");
});
