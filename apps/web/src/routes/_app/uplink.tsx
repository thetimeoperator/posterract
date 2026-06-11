import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel } from "@posterract/hyperkit";

export const Route = createFileRoute("/_app/uplink")({
  component: UplinkPage,
});

function UplinkPage() {
  return (
    <Panel brackets className="min-h-[60vh]">
      <EmptyState
        title="This deck is being assembled."
        detail="The uplink surface comes online in a later phase of construction."
      />
    </Panel>
  );
}
