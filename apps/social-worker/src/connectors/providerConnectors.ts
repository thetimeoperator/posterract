import type { PlatformConnector, PlatformId } from "@vidtryx/social-contract";
import { PLATFORM_CAPABILITIES } from "@vidtryx/social-contract/platformCapabilities";
import type { ConnectorMode } from "../env";
import { createNotConfiguredConnector } from "./base";
import { createFakeConnector } from "./fakeConnector";

const liveConnectors = new Map<PlatformId, PlatformConnector>(
  PLATFORM_CAPABILITIES.map((capability) => [
    capability.provider,
    createNotConfiguredConnector(capability.provider, capability.requiredScopes),
  ]),
);

export function getConnector(provider: PlatformId, mode: ConnectorMode): PlatformConnector {
  if (mode === "fake") return createFakeConnector(provider);
  const connector = liveConnectors.get(provider);
  if (!connector) return createNotConfiguredConnector(provider, []);
  return connector;
}
