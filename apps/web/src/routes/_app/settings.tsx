import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Input, Modal, Panel, PlatformChip, Toggle, pushSignal } from "@posterract/hyperkit";
import { PLATFORM_IDS, type PlatformId } from "@posterract/contract";
import { useProfile, initials } from "@/state/profile";
import { blobStore } from "@/engine/idb";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const profile = useProfile();
  const update = useProfile((s) => s.update);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const toggleDefaultPlatform = (p: PlatformId) =>
    update({
      defaultPlatforms: profile.defaultPlatforms.includes(p)
        ? profile.defaultPlatforms.filter((x) => x !== p)
        : [...profile.defaultPlatforms, p],
    });

  const wipeLocalData = async () => {
    const keys = await blobStore.keys().catch(() => []);
    await Promise.all(keys.map((k) => blobStore.delete(String(k)).catch(() => {})));
    window.localStorage.removeItem("posterract.engine");
    window.localStorage.removeItem("posterract.samples");
    setConfirmWipe(false);
    pushSignal({ tone: "info", title: "Local data cleared", detail: "Reloading with a clean hold…" });
    setTimeout(() => window.location.assign("/"), 800);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Panel kicker="Profile" title="Who's operating" brackets>
        <div className="flex items-start gap-5">
          <span className="border-aurora flex h-14 w-14 flex-none items-center justify-center rounded-full font-display text-[18px] font-bold text-starlight">
            {initials(profile.displayName)}
          </span>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <Input
              label="Display name"
              value={profile.displayName}
              onChange={(e) => update({ displayName: e.target.value })}
            />
            <Input
              label="Handle"
              value={profile.handle}
              onChange={(e) => update({ handle: e.target.value })}
              hint="Shown in the account menu; real accounts arrive with cloud sign-in."
            />
          </div>
        </div>
      </Panel>

      <Panel kicker="Workspace" title="The vessel" brackets>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Workspace name"
            value={profile.workspaceName}
            onChange={(e) => update({ workspaceName: e.target.value })}
          />
          <Input
            label="Timezone"
            value={profile.timezone}
            onChange={(e) => update({ timezone: e.target.value })}
            hint="Used for scheduling display."
          />
        </div>
      </Panel>

      <Panel kicker="Preferences" title="Defaults" brackets>
        <div className="space-y-4">
          <div>
            <p className="kicker mb-2">Default platforms for new posts</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_IDS.map((p) => (
                <PlatformChip
                  key={p}
                  platform={p}
                  selected={profile.defaultPlatforms.includes(p)}
                  onClick={() => toggleDefaultPlatform(p)}
                />
              ))}
            </div>
          </div>
          <Toggle
            checked={profile.shipAudio}
            onChange={(shipAudio) => update({ shipAudio })}
            label="Ship audio"
            description="Soft confirmation ping when a post goes live. (Lands with the polish pass.)"
          />
        </div>
      </Panel>

      <Panel kicker="Danger zone" title="The airlock" brackets className="border-[rgba(255,113,143,0.3)]">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12.5px] text-starlight-dim">
            Clear all local data — uploaded videos, posts, history, samples. This cannot be undone.
          </p>
          <Button variant="destructive" onClick={() => setConfirmWipe(true)}>
            Clear local data
          </Button>
        </div>
      </Panel>

      <Modal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        kicker="Airlock"
        title="Clear all local data?"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirmWipe(false)}>
              Keep my data
            </Button>
            <Button variant="destructive" onClick={() => void wipeLocalData()}>
              Clear everything
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-starlight-dim">
          Every video in the Library and every post in your history will be released into the void.
        </p>
      </Modal>
    </div>
  );
}
