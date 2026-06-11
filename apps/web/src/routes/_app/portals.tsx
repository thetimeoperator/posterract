import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel } from "@posterract/hyperkit";

export const Route = createFileRoute("/_app/portals")({
  component: PortalsPage,
});

function PortalsPage() {
  return (
    <Panel brackets className="min-h-[60vh]">
      <EmptyState
        title="This deck is being assembled."
        detail="The portals surface comes online in a later phase of construction."
      />
    </Panel>
  );
}
