import type {
  ConnectedAccount,
  OAuthCallbackInput,
  OAuthStart,
  OAuthStartInput,
  PlatformConnector,
  PlatformId,
  PostPackageDTO,
  PublishInput,
  PublishResult,
  ValidationResult,
} from "@vidtryx/social-contract";

export function createFakeConnector(provider: PlatformId): PlatformConnector {
  return {
    provider,
    requiredScopes: ["fake.publish"],

    startOAuth(input: OAuthStartInput): OAuthStart {
      const state = `fake_${provider}_${Date.now()}`;
      return {
        authorizationUrl: `${input.redirectUri}?provider=${provider}&state=${state}`,
        state,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    },

    async handleOAuthCallback(input: OAuthCallbackInput): Promise<ConnectedAccount> {
      return {
        provider: input.provider,
        providerAccountId: `fake_${input.provider}`,
        handle: `@fake_${input.provider}`,
        scopes: ["fake.publish"],
      };
    },

    async refreshToken(_accountId: string): Promise<void> {
      return;
    },

    async validatePackage(postPackage: PostPackageDTO): Promise<ValidationResult> {
      if (!postPackage.caption.trim() && postPackage.hashtags.length === 0) {
        return {
          ok: false,
          category: "missing_copy",
          message: "Caption or hashtags are required for the fake connector.",
          retryable: false,
        };
      }
      return { ok: true };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      return {
        status: "posted",
        platformMediaId: `fake_media_${input.jobId}`,
        platformPostId: `fake_post_${input.jobId}`,
        platformPostUrl: `https://example.com/${input.provider}/${input.jobId}`,
        providerResponseSummary: "Fake connector posted successfully.",
      };
    },

    async revoke(_accountId: string): Promise<void> {
      return;
    },
  };
}
