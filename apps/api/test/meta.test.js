import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyMetaSignedRequest } from "../src/meta.js";

test("Meta signed requests are authenticated before accepting deletion callbacks", () => {
  const previous = process.env.INSTAGRAM_APP_SECRET;
  process.env.INSTAGRAM_APP_SECRET = "test-instagram-secret";
  try {
    const payload = Buffer.from(
      JSON.stringify({
        algorithm: "HMAC-SHA256",
        user_id: "provider-user-123",
        issued_at: 1_786_000_000,
      }),
    ).toString("base64url");
    const signature = createHmac(
      "sha256",
      process.env.INSTAGRAM_APP_SECRET,
    )
      .update(payload)
      .digest("base64url");
    assert.deepEqual(
      verifyMetaSignedRequest("instagram", `${signature}.${payload}`),
      { userId: "provider-user-123", issuedAt: 1_786_000_000 },
    );
    assert.throws(
      () => verifyMetaSignedRequest("instagram", `AAAA.${payload}`),
      /Invalid signed request/,
    );
  } finally {
    if (previous === undefined) delete process.env.INSTAGRAM_APP_SECRET;
    else process.env.INSTAGRAM_APP_SECRET = previous;
  }
});
