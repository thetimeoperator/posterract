import assert from "node:assert/strict";
import test from "node:test";
import { tiktokUploadVideoDraft } from "../../web/convex/connectors/tiktok.ts";

test("TikTok video publishing uses the inbox draft endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const requests = [];

  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 0;
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/v2/post/publish/inbox/video/init/")) {
      return Response.json({
        data: {
          publish_id: "v_inbox_file~v2.test",
          upload_url: "https://open-upload.tiktokapis.com/video/test",
        },
        error: { code: "ok", message: "" },
      });
    }
    if (url === "https://media.posterract.test/video.mp4") {
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 });
    }
    if (url === "https://open-upload.tiktokapis.com/video/test") {
      return new Response(null, { status: 201 });
    }
    if (url.endsWith("/v2/post/publish/status/fetch/")) {
      return Response.json({
        data: { status: "SEND_TO_USER_INBOX" },
        error: { code: "ok", message: "" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await tiktokUploadVideoDraft({
      accessToken: "test-token",
      videoUrl: "https://media.posterract.test/video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4,
    });

    assert.deepEqual(result, {
      publishId: "v_inbox_file~v2.test",
      inboxDelivered: true,
    });
    assert.equal(
      requests.some(({ url }) => url.endsWith("/v2/post/publish/inbox/video/init/")),
      true,
    );
    assert.equal(
      requests.some(({ url }) => url.endsWith("/v2/post/publish/video/init/")),
      false,
    );
    const initRequest = requests.find(({ url }) =>
      url.endsWith("/v2/post/publish/inbox/video/init/"),
    );
    const body = JSON.parse(initRequest.init.body);
    assert.deepEqual(body, {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: 4,
        chunk_size: 4,
        total_chunk_count: 1,
      },
    });
    assert.equal("post_info" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
