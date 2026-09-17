import test from "node:test";
import assert from "node:assert/strict";
import { emptyTikTokOptions, validateTikTokOptions } from "../../../packages/contract/src/tiktok.ts";
import { tiktokInitDirect, tiktokDirectStatus, tiktokCreatorInfo, TikTokApiError, tiktokPostingRestrictionMessage } from "../../web/convex/connectors/tiktokDirect.ts";

test("Direct Post sends chosen settings and PULL_FROM_URL to video/init only", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://open.tiktokapis.com/v2/post/publish/video/init/");
      const payload = JSON.parse(init.body);
      assert.equal(payload.source_info.source, "PULL_FROM_URL");
      assert.equal(payload.source_info.video_url, "https://www.posterract.app/v1/tiktok/media/test");
      assert.deepEqual(payload.post_info, { title: "Chosen caption #tag", privacy_level: "SELF_ONLY", disable_comment: true,
        disable_duet: true, disable_stitch: true, brand_organic_toggle: false, brand_content_toggle: false, is_aigc: true });
      return Response.json({ data: { publish_id: "known-id" }, error: { code: "ok" } });
    };
    assert.equal(await tiktokInitDirect("test-token", { ...emptyTikTokOptions(), privacyLevel: "SELF_ONLY", isAigc: true }, "Chosen caption #tag", "https://www.posterract.app/v1/tiktok/media/test"), "known-id");
  } finally { globalThis.fetch = original; }
});

test("status preserves int64 public IDs and accepts completion without a public ID", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":{"code":"ok"},"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7659589766941247509, 7659589766941247510]}}');
    assert.deepEqual((await tiktokDirectStatus("token", "id")).publicaly_available_post_id, ["7659589766941247509", "7659589766941247510"]);
    globalThis.fetch = async () => Response.json({ error: { code: "ok" }, data: { status: "PUBLISH_COMPLETE" } });
    assert.equal((await tiktokDirectStatus("token", "id")).status, "PUBLISH_COMPLETE");
  } finally { globalThis.fetch = original; }
});

test("lost init acknowledgement is ambiguous; an explicit rate-limit rejection is not", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError("network lost"); };
    await assert.rejects(tiktokInitDirect("token", emptyTikTokOptions(), "", "url"), (e) => e instanceof TikTokApiError && e.ambiguous);
    globalThis.fetch = async () => Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 });
    await assert.rejects(tiktokInitDirect("token", emptyTikTokOptions(), "", "url"), (e) => !e.ambiguous && e.category === "rate_limit");
  } finally { globalThis.fetch = original; }
});

test("creator posting restrictions returned with HTTP 200 are terminal, not temporary request rate limits", async () => {
  const original = globalThis.fetch;
  try {
    for (const code of ["spam_risk_too_many_posts", "reached_active_user_cap", "spam_risk_user_banned_from_posting"]) {
      globalThis.fetch = async () => Response.json({ error: { code } });
      await assert.rejects(tiktokCreatorInfo("token"), (e) => e.code === code && e.category === "posting_restricted");
      assert.match(tiktokPostingRestrictionMessage(code), /attempt has stopped.*try again later/i);
      globalThis.fetch = async () => Response.json({ error: { code } }, { status: 403 });
      await assert.rejects(tiktokInitDirect("token", emptyTikTokOptions(), "", "url"),
        (e) => e.code === code && e.category === "posting_restricted" && !e.ambiguous);
    }
    assert.equal(new TikTokApiError("rate_limit_exceeded", 429).category, "rate_limit");
    assert.equal(tiktokPostingRestrictionMessage("rate_limit_exceeded"), undefined);
  } finally { globalThis.fetch = original; }
});

test("privacy, disclosure and current creator restrictions are validated without audience coercion", () => {
  const base = emptyTikTokOptions();
  assert.match(validateTikTokOptions(base), /Choose who/);
  const selected = { ...base, privacyLevel: "SELF_ONLY" };
  assert.equal(validateTikTokOptions(selected), undefined);
  assert.match(validateTikTokOptions({ ...selected, commercialContent: true }), /Indicate/);
  assert.match(validateTikTokOptions({ ...selected, commercialContent: true, brandContent: true }), /private/);
  assert.equal(validateTikTokOptions({ ...selected, commercialContent: true, brandOrganic: true }), undefined);
  const info = { privacy_level_options: ["SELF_ONLY"], comment_disabled: true, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 60 };
  assert.match(validateTikTokOptions({ ...selected, allowComment: true }, info), /disabled/);
  assert.match(validateTikTokOptions(selected, info, 61_000), /60 seconds/);
  assert.match(validateTikTokOptions({ ...selected, privacyLevel: "PUBLIC_TO_EVERYONE" }, info), /no longer/);
  assert.equal(validateTikTokOptions({}), undefined, "legacy defaults to inbox");
  assert.equal(validateTikTokOptions({ mode: "inbox" }), undefined);
});
