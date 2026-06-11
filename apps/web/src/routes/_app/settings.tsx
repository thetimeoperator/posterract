import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Panel } from "@posterract/hyperkit";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <Panel brackets className="min-h-[60vh]">
      <EmptyState
        title="This deck is being assembled."
        detail="The settings surface comes online in a later phase of construction."
      />
    </Panel>
  );
}
