import test from "node:test";
import assert from "node:assert/strict";
import { facebookPublishReel } from "../../web/convex/connectors/facebook.ts";

/**
 * Facebook's own glitches on a Reel (Oct 8 2026): a 500 from its upload
 * server, a publish refused with "There was a problem uploading your video
 * file", and "does not exist" for a Reel that was live. Each is retried on the
 * same video, so none can post a Reel twice.
 */

const UPLOAD_URL = "https://rupload.facebook.com/video-upload/v23.0/vid1";
const FAST = { retryWaitMs: 1, statusDeadlineMs: 200, pollMs: 1 };
const NOT_FOUND = {
  status: 400,
  body: {
    error: {
      code: 100,
      error_subcode: 33,
      message: "Unsupported get request. Object with ID 'vid1' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
    },
  },
};
const READY = { status: 200, body: { status: { video_status: "ready" }, permalink_url: "/reel/vid1/" } };

/** A fake Facebook: each step answers from its list in order, repeating the last answer. */
function fakeFacebook({ upload = [{ status: 200, body: { success: true } }], finish = [{ status: 200, body: { success: true } }], status = [READY] }) {
  const calls = { start: 0, upload: 0, finish: 0, status: 0 };
  const answer = (list, count) => {
    const { status: code, body } = list[Math.min(count - 1, list.length - 1)];
    return new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
  };
  const fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === UPLOAD_URL) return answer(upload, ++calls.upload);
    if (url.endsWith("/me/video_reels")) {
      const phase = new URLSearchParams(String(init.body)).get("upload_phase");
      if (phase === "start") {
        calls.start += 1;
        return Response.json({ video_id: "vid1", upload_url: UPLOAD_URL });
      }
      return answer(finish, ++calls.finish);
    }
    if (url.includes("/vid1?")) return answer(status, ++calls.status);
    throw new Error(`unexpected request ${url}`);
  };
  return { calls, fetch };
}

async function publishWith(fake) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await facebookPublishReel({
      pageId: "page1",
      pageAccessToken: "page-token",
      videoUrl: "https://media.example/video.mp4",
      title: "Title",
      description: "Caption",
      timing: FAST,
    });
  } finally {
    globalThis.fetch = original;
  }
}

test("a 500 from Facebook's upload server is sent again to the same upload, and the Reel publishes", async () => {
  const fake = fakeFacebook({ upload: [{ status: 500, body: { error: { message: "Internal" } } }, { status: 200, body: { success: true } }] });
  assert.deepEqual(await publishWith(fake), { videoId: "vid1", permalink: "/reel/vid1/" });
  assert.deepEqual(fake.calls, { start: 1, upload: 2, finish: 1, status: 1 });
});

test("a refused publish is asked again for the same video, never a new upload", async () => {
  const fake = fakeFacebook({
    finish: [
      { status: 400, body: { error: { message: "There was a problem uploading your video file. Please try again with another file." } } },
      { status: 200, body: { success: true } },
    ],
  });
  assert.deepEqual(await publishWith(fake), { videoId: "vid1", permalink: "/reel/vid1/" });
  assert.equal(fake.calls.start, 1);
  assert.equal(fake.calls.upload, 1);
  assert.equal(fake.calls.finish, 2);
});

test("'does not exist' right after publishing waits for the Reel to show up", async () => {
  const fake = fakeFacebook({ status: [NOT_FOUND, NOT_FOUND, READY] });
  assert.deepEqual(await publishWith(fake), { videoId: "vid1", permalink: "/reel/vid1/" });
  assert.equal(fake.calls.status, 3);
});

test("a Reel that never shows up fails without blaming the account, and is never retried", async () => {
  const fake = fakeFacebook({ status: [NOT_FOUND] });
  await assert.rejects(publishWith(fake), (error) => {
    assert.match(error.message, /hasn't shown it yet/);
    assert.doesNotMatch(error.message, /permission|token|reconnect/i);
    assert.equal(error.retryable, undefined);
    return true;
  });
});

test("an upload Facebook keeps failing with 500 may be started again later: nothing was published", async () => {
  const fake = fakeFacebook({ upload: [{ status: 500, body: {} }] });
  await assert.rejects(publishWith(fake), (error) => {
    assert.match(error.message, /Facebook Reel upload failed/);
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(fake.calls.upload, 3);
  assert.equal(fake.calls.finish, 0);
});

test("an upload Facebook refuses outright (4xx) is not tried again", async () => {
  const fake = fakeFacebook({ upload: [{ status: 400, body: { error: { message: "Bad file_url" } } }] });
  await assert.rejects(publishWith(fake), (error) => {
    assert.match(error.message, /Bad file_url/);
    assert.equal(error.retryable, undefined);
    return true;
  });
  assert.equal(fake.calls.upload, 1);
});

test("a publish refused three times fails, unless the Reel shows it was published anyway", async () => {
  const refused = [{ status: 400, body: { error: { message: "There was a problem uploading your video file." } } }];
  await assert.rejects(publishWith(fakeFacebook({ finish: refused, status: [NOT_FOUND] })), (error) => {
    assert.match(error.message, /Facebook Reel publish failed: There was a problem uploading your video file/);
    assert.equal(error.retryable, undefined);
    return true;
  });
  const publishedAnyway = fakeFacebook({ finish: refused, status: [READY] });
  assert.deepEqual(await publishWith(publishedAnyway), { videoId: "vid1", permalink: "/reel/vid1/" });
  assert.equal(publishedAnyway.calls.finish, 3);
});
