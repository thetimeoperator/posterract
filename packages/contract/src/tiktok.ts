/** Shared web/API/worker contract. Missing mode always means the legacy inbox flow. */
export const TIKTOK_PRIVACY_LEVELS = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type TikTokPrivacy = typeof TIKTOK_PRIVACY_LEVELS[number];
export type TikTokCreatorInfo = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};
export type TikTokPostOptions = {
  mode: "direct" | "inbox";
  privacyLevel: TikTokPrivacy | "";
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercialContent: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  isAigc: boolean;
  consentAccepted?: boolean;
};
export const emptyTikTokOptions = (): TikTokPostOptions => ({
  mode: "direct", privacyLevel: "", allowComment: false, allowDuet: false,
  allowStitch: false, commercialContent: false, brandOrganic: false,
  brandContent: false, isAigc: false,
});

/** Return a user-readable reason; never silently coerce an audience or interaction. */
export function validateTikTokOptions(options: Record<string, unknown>, creator?: TikTokCreatorInfo, durationMs?: number): string | undefined {
  if (options.mode === undefined || options.mode === "inbox") return;
  if (options.mode !== "direct") return "Choose a valid TikTok posting mode.";
  if (!(TIKTOK_PRIVACY_LEVELS as readonly unknown[]).includes(options.privacyLevel)) return "Choose who can view this TikTok post.";
  for (const field of ["allowComment", "allowDuet", "allowStitch", "commercialContent", "brandOrganic", "brandContent", "isAigc"]) {
    if (typeof options[field] !== "boolean") return `TikTok setting ${field} must be true or false.`;
  }
  if (options.commercialContent && !options.brandOrganic && !options.brandContent) return "Indicate whether this promotes your brand, another brand, or both.";
  if (!options.commercialContent && (options.brandOrganic || options.brandContent)) return "Enable commercial-content disclosure for promotional content.";
  if (options.brandContent && options.privacyLevel === "SELF_ONLY") return "Branded content visibility cannot be set to private.";
  if (creator) {
    if (!creator.privacy_level_options.includes(options.privacyLevel as TikTokPrivacy)) return "This audience is no longer available for this TikTok account. Review the post settings.";
    if ((options.allowComment && creator.comment_disabled) || (options.allowDuet && creator.duet_disabled) || (options.allowStitch && creator.stitch_disabled)) return "TikTok has disabled a selected interaction. Review the post settings.";
    if (durationMs !== undefined && durationMs / 1000 > creator.max_video_post_duration_sec) return `This TikTok account permits videos up to ${creator.max_video_post_duration_sec} seconds.`;
  }
}

export function tikTokPostInfo(options: TikTokPostOptions, caption: string) {
  return {
    title: caption, privacy_level: options.privacyLevel,
    disable_comment: !options.allowComment, disable_duet: !options.allowDuet,
    disable_stitch: !options.allowStitch, brand_organic_toggle: options.brandOrganic,
    brand_content_toggle: options.brandContent, is_aigc: options.isAigc,
  };
}
