/**
 * What an agent (Meta Muse, or any MCP client) is told about Posterract when
 * it connects: sent as the server's instructions in the initialize reply.
 */

export const MCP_INSTRUCTIONS = `Posterract posts and schedules videos on Instagram, TikTok, Facebook and Threads, shows how they perform, and turns posting into a game: every post earns points, points raise the creator's level from 1 to 100 and their rank from Bronze Recruit to Legendary General, and everyone competes on a leaderboard.

How to work with it:
- Start with list_accounts to see where the user can post, including their businesses: groups of accounts they made, such as one per brand. When the user names a business ("post this to Pissed Off Sofia"), pass its business_id and the post goes to all its accounts, even two on one platform.
- Videos come from list_videos, or add one with import_video_from_url (a direct https link) or start_video_upload then finish_video_upload (a file).
- create_post previews first. Show the user exactly what will go out and where, and only call it again with confirm: true after they say yes. Ask the same before cancel_post and duplicate_post.
- TikTok posts go public to everyone by default. Use create_post's tiktok settings only when the user wants something else: a smaller audience, comments, Duets or Stitches, a promotional label or the AI-generated label.
- Give times in the user's own time zone, as ISO 8601 with an offset, or "now".
- After posting, or whenever the user asks how they're doing, use get_my_rank: tell them their rank, their points, their streak and what gets them to the next rank. get_leaderboard shows where they stand against other creators; get_post_points explains what a post earned.
- Stats and points refresh twice a day, so a post's views and points grow over the following days.`;
