import { useEffect, useState } from "react";
import { Button, Panel, pushSignal } from "@posterract/hyperkit";
import { posterractApiUrl } from "@/lib/authClient";
import { cloudFetch, cloudJson } from "@/lib/cloudRequest";

/**
 * AI assistants (such as Meta Muse) the user connected through the sign-in
 * link on /connect. Shows nothing until one is connected.
 */

type Connection = {
  id: string;
  appName: string;
  permissions: string[];
  connectedAt: number;
  lastUsedAt?: number;
};

const apiBase = posterractApiUrl ?? "";
const day = (time: number) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ConnectedApps() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [removing, setRemoving] = useState<string>();

  useEffect(() => {
    if (!apiBase) return;
    const controller = new AbortController();
    cloudJson<{ connections: Connection[] }>(apiBase, "/v1/oauth/connections", { signal: controller.signal, cache: "no-store" })
      .then((result) => { if (!controller.signal.aborted) setConnections(result.connections); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const disconnect = async (connection: Connection) => {
    setRemoving(connection.id);
    const response = await cloudFetch(apiBase, `/v1/oauth/connections/${connection.id}`, { method: "DELETE" }).catch(() => undefined);
    setRemoving(undefined);
    if (!response?.ok && response?.status !== 404) {
      pushSignal({ tone: "danger", title: "Couldn't disconnect", detail: "Try again in a minute." });
      return;
    }
    setConnections((current) => current.filter((item) => item.id !== connection.id));
    pushSignal({ tone: "success", title: `${connection.appName} disconnected`, detail: "It can no longer reach your Posterract." });
  };

  if (connections.length === 0) return null;
  return (
    <Panel kicker="Assistants" title="Connected apps" brackets>
      <ul className="divide-y divide-white/[0.06]">
        {connections.map((connection) => (
          <li key={connection.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-display text-[14px] font-semibold text-starlight">{connection.appName}</p>
              <p className="mt-0.5 text-[11px] text-starlight-faint">
                Connected {day(connection.connectedAt)}
                {connection.lastUsedAt ? ` · last used ${day(connection.lastUsedAt)}` : ""}
              </p>
            </div>
            <Button variant="tertiary" disabled={removing === connection.id} onClick={() => void disconnect(connection)}>
              {removing === connection.id ? "Disconnecting…" : "Disconnect"}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
