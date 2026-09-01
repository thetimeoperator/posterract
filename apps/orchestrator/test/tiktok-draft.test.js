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

test("TikTok draft upload merges trailing bytes into the final declared chunk", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const requests = [];
  const productionVideoSize = 94_055_947;

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
          publish_id: "v_inbox_file~v2.production-size",
          upload_url: "https://open-upload.tiktokapis.com/video/production-size",
        },
        error: { code: "ok", message: "" },
      });
    }
    if (url === "https://media.posterract.test/production-size.mp4") {
      const range = new Headers(init.headers).get("Range");
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
      assert.ok(match);
      return new Response(new Uint8Array(Number(match[2]) - Number(match[1]) + 1), { status: 206 });
    }
    if (url === "https://open-upload.tiktokapis.com/video/production-size") {
      const range = new Headers(init.headers).get("Content-Range");
      return new Response(null, { status: range?.startsWith("bytes 0-") ? 206 : 201 });
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
      videoUrl: "https://media.posterract.test/production-size.mp4",
      mimeType: "video/mp4",
      sizeBytes: productionVideoSize,
    });

    assert.equal(result.inboxDelivered, true);
    const initRequest = requests.find(({ url }) =>
      url.endsWith("/v2/post/publish/inbox/video/init/"),
    );
    const sourceInfo = JSON.parse(initRequest.init.body).source_info;
    assert.deepEqual(sourceInfo, {
      source: "FILE_UPLOAD",
      video_size: productionVideoSize,
      chunk_size: 47_027_973,
      total_chunk_count: 2,
    });

    const uploads = requests.filter(
      ({ url, init }) =>
        url === "https://open-upload.tiktokapis.com/video/production-size" && init.method === "PUT",
    );
    assert.equal(uploads.length, 2);
    assert.equal(new Headers(uploads[0].init.headers).get("Content-Range"),
      "bytes 0-47027972/94055947");
    assert.equal(new Headers(uploads[1].init.headers).get("Content-Range"),
      "bytes 47027973-94055946/94055947");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
