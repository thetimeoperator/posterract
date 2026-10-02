import assert from "node:assert/strict";
import test from "node:test";
import { instagramListMedia } from "../../web/convex/connectors/instagram.ts";
import { threadsListPosts } from "../../web/convex/connectors/threads.ts";
import { facebookListPagePosts } from "../../web/convex/connectors/facebook.ts";
import { tiktokListVideos } from "../../web/convex/connectors/tiktok.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-01T12:00:00Z");
const graphTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+0000");

/** Answers each fetch with the next scripted response and records the URLs. */
function scriptFetch(responses) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Instagram: every post since the cutoff across pages, a pinned old post at the top included in the walk", async () => {
  const since = NOW - 7 * DAY;
  const { calls, restore } = scriptFetch([
    {
      body: {
        data: [
          { id: "pinned", timestamp: graphTime(NOW - 200 * DAY), media_product_type: "REELS" },
          { id: "a", timestamp: graphTime(NOW - 1 * DAY), media_product_type: "REELS", permalink: "https://ig/a" },
          { id: "b", timestamp: graphTime(NOW - 2 * DAY), media_product_type: "FEED" },
        ],
        paging: { next: "https://graph.instagram.com/next-page" },
      },
    },
    {
      body: {
        data: [
          { id: "c", timestamp: graphTime(NOW - 6 * DAY), media_product_type: "REELS" },
          { id: "old", timestamp: graphTime(NOW - 9 * DAY), media_product_type: "REELS" },
        ],
        paging: { next: "https://graph.instagram.com/never-read" },
      },
    },
  ]);
  try {
    const result = await instagramListMedia({ userId: "17841", accessToken: "token", since });
    assert.deepEqual(result.posts.map((post) => post.id), ["a", "b", "c"]);
    assert.equal(result.complete, true);
    assert.equal(result.posts[0].permalink, "https://ig/a");
    assert.equal(result.posts[0].kind, "reels");
    assert.equal(result.posts[0].publishedAt, NOW - 1 * DAY);
    assert.equal(calls.length, 2, "stops once a page ends before the cutoff");
    assert.match(calls[0].url, /\/17841\/media\?fields=id%2Ctimestamp%2Cmedia_product_type%2Cpermalink/);
  } finally {
    restore();
  }
});

test("Instagram: the page limit leaves the list marked incomplete", async () => {
  const page = (offset) => ({
    body: {
      data: [{ id: `p${offset}`, timestamp: graphTime(NOW - offset * DAY), media_product_type: "REELS" }],
      paging: { next: `https://graph.instagram.com/page-${offset + 1}` },
    },
  });
  const { restore } = scriptFetch([page(1), page(2)]);
  try {
    const result = await instagramListMedia({ userId: "1", accessToken: "t", since: NOW - 100 * DAY, maxPages: 2 });
    assert.equal(result.complete, false);
    assert.deepEqual(result.posts.map((post) => post.id), ["p1", "p2"]);
  } finally {
    restore();
  }
});

test("Instagram: a revoked token surfaces the platform's own message", async () => {
  const { restore } = scriptFetch([
    { status: 400, body: { error: { message: "Error validating access token: The session has been invalidated." } } },
  ]);
  try {
    await assert.rejects(
      instagramListMedia({ userId: "1", accessToken: "t", since: NOW - DAY }),
      /Instagram media list failed: Error validating access token/,
    );
  } finally {
    restore();
  }
});

test("Threads: reposts of other people's threads are not the account's posts", async () => {
  const { calls, restore } = scriptFetch([
    {
      body: {
        data: [
          { id: "t1", timestamp: graphTime(NOW - DAY), media_type: "VIDEO" },
          { id: "r1", timestamp: graphTime(NOW - 2 * DAY), media_type: "REPOST_FACADE" },
          { id: "t2", timestamp: graphTime(NOW - 3 * DAY), media_type: "TEXT_POST" },
        ],
      },
    },
  ]);
  try {
    const result = await threadsListPosts({ accessToken: "t", since: NOW - 7 * DAY });
    assert.deepEqual(result.posts.map((post) => post.id), ["t1", "t2"]);
    assert.equal(result.complete, true);
    assert.match(calls[0].url, /\/me\/threads\?.*since=\d+/);
  } finally {
    restore();
  }
});

test("Facebook: a Page token that can't read /{page-id} falls back to /me", async () => {
  const { calls, restore } = scriptFetch([
    { status: 400, body: { error: { message: "Unsupported get request." } } },
    { body: { data: [{ id: "123_456", created_time: graphTime(NOW - DAY), permalink_url: "https://fb/p" }] } },
  ]);
  try {
    const result = await facebookListPagePosts({ pageId: "123", pageAccessToken: "t", since: NOW - 7 * DAY });
    assert.deepEqual(result.posts.map((post) => post.id), ["123_456"]);
    assert.match(calls[0].url, /\/123\/published_posts/);
    assert.match(calls[1].url, /\/me\/published_posts/);
  } finally {
    restore();
  }
});

test("TikTok: pages by cursor and stops at the cutoff", async () => {
  const seconds = (ms) => Math.floor(ms / 1000);
  const { calls, restore } = scriptFetch([
    {
      body: {
        data: {
          videos: [
            { id: "v1", create_time: seconds(NOW - DAY), share_url: "https://tiktok/v1" },
            { id: "v2", create_time: seconds(NOW - 2 * DAY) },
          ],
          cursor: 1700000000000,
          has_more: true,
        },
        error: { code: "ok" },
      },
    },
    {
      body: {
        data: {
          videos: [
            { id: "v3", create_time: seconds(NOW - 3 * DAY) },
            { id: "v4", create_time: seconds(NOW - 30 * DAY) },
          ],
          cursor: 1600000000000,
          has_more: true,
        },
        error: { code: "ok" },
      },
    },
  ]);
  try {
    const result = await tiktokListVideos("t", NOW - 7 * DAY);
    assert.deepEqual(result.posts.map((post) => post.id), ["v1", "v2", "v3"]);
    assert.equal(result.complete, true);
    assert.equal(result.posts[0].permalink, "https://tiktok/v1");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body, { max_count: 20 });
    assert.deepEqual(calls[1].body, { max_count: 20, cursor: 1700000000000 });
    assert.match(calls[0].url, /\/v2\/video\/list\/\?fields=id,create_time,share_url$/);
  } finally {
    restore();
  }
});
