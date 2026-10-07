import { PUBLISHING_PLATFORM_IDS, type PlatformId } from "@posterract/contract";

/**
 * The publishing platforms a composer link names in `platforms`
 * (comma-separated), in order: a rank card's Post opens on Instagram,
 * Facebook and Threads. Undefined when it names none.
 */
export function startingPlatforms(value: string | undefined): PlatformId[] | undefined {
  const named = (value ?? "").split(",").filter((p): p is PlatformId => (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(p));
  return named.length ? [...new Set(named)] : undefined;
}
