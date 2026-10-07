/**
 * Reading every post on an account, whichever app or tool made it. Shared by
 * the Instagram, Threads and Facebook list helpers (Graph-style `data` +
 * `paging.next` pages); TikTok pages by cursor in tiktok.ts.
 */

export type PlatformPost = {
  id: string;
  /** Epoch ms the post went live. */
  publishedAt: number;
  permalink?: string;
  kind?: string;
  /** Its caption or text, where the platform lists one: the Points feed's title. */
  caption?: string;
};

/** `complete` is false when the page limit cut the walk short of `since`. */
export type PlatformPostList = { posts: PlatformPost[]; complete: boolean };

/** Graph timestamps end in `+0000`; make them strict ISO before parsing. */
export function parseGraphTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/**
 * Walks a Graph list newest first and keeps the posts made since `since`
 * (epoch ms). Pinned posts can sit out of date order at the top, so the walk
 * stops only once a page ends before `since`.
 */
export async function collectGraphPosts<T>(args: {
  firstPage: string;
  since: number;
  maxPages: number;
  label: string;
  time: (item: T) => number;
  toPost: (item: T) => PlatformPost | undefined;
}): Promise<PlatformPostList> {
  const posts: PlatformPost[] = [];
  let next: string | undefined = args.firstPage;
  for (let page = 0; next; page += 1) {
    if (page >= args.maxPages) return { posts, complete: false };
    const response = await fetch(next);
    const body = (await response.json()) as {
      data?: T[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || body.error) {
      throw new Error(`${args.label} failed: ${body.error?.message ?? response.status}`);
    }
    const items = body.data ?? [];
    for (const item of items) {
      const post = args.toPost(item);
      if (post && post.publishedAt >= args.since) posts.push(post);
    }
    const last = items.at(-1);
    if (!last || !(args.time(last) >= args.since)) break;
    next = body.paging?.next;
  }
  return { posts, complete: true };
}
