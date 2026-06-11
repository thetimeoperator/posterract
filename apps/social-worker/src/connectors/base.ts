import type {
  ConnectedAccount,
  OAuthCallbackInput,
  OAuthStart,
  OAuthStartInput,
  PlatformConnector,
  PlatformId,
  PostPackageDTO,
  PublishInput,
  PublishJobStatus,
  PublishResult,
  PublishStatus,
  ValidationResult,
} from "@vidtryx/social-contract";

export class ConnectorExecutionError extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly retryable: boolean,
    readonly status: PublishJobStatus = retryable ? "retrying" : "failed",
  ) {
    super(message);
    this.name = "ConnectorExecutionError";
  }
}

const unsupportedOAuth = (provider: PlatformId): never => {
  throw new ConnectorExecutionError(`${provider} OAuth is not implemented in this worker scaffold.`, "not_configured", false);
};

export function createNotConfiguredConnector(provider: PlatformId, requiredScopes: string[]): PlatformConnector {
  return {
    provider,
    requiredScopes,
    startOAuth(_input: OAuthStartInput): OAuthStart {
      return unsupportedOAuth(provider);
    },
    async handleOAuthCallback(_input: OAuthCallbackInput): Promise<ConnectedAccount> {
      return unsupportedOAuth(provider);
    },
    async refreshToken(_accountId: string): Promise<void> {
      unsupportedOAuth(provider);
    },
    async validatePackage(postPackage: PostPackageDTO): Promise<ValidationResult> {
      if (!postPackage.mediaAssetId && !postPackage.mediaStoragePath) {
        return {
          ok: false,
          category: "missing_media",
          message: "A media asset is required before this package can be published.",
          retryable: false,
        };
      }
      return { ok: true, warnings: [`${provider} live connector is not enabled yet.`] };
    },
    async publish(_input: PublishInput): Promise<PublishResult> {
      throw new ConnectorExecutionError(
        `${provider} live connector is not configured yet.`,
        "connector_not_configured",
        false,
        "blocked_by_platform",
      );
    },
    async getStatus(_providerPostId: string): Promise<PublishStatus> {
      throw new ConnectorExecutionError(
        `${provider} status polling is not configured yet.`,
        "connector_not_configured",
        false,
        "blocked_by_platform",
      );
    },
    async revoke(_accountId: string): Promise<void> {
      unsupportedOAuth(provider);
    },
  };
}
