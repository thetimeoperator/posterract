/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";
import { useTrait, useWorld } from "@posterract/koota-solid";
import {
  AssetId, Audio, MotionBlur, Paint, PaintType, Tempo, beatsAsset, getAsset, getEntityTree,
} from "@posterract/video-runtime";
import { useEditor } from "@/engine/hooks";
import { blurWhilePlaying, setBlurWhilePlaying } from "@/engine/motion-blur-preview";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlRow } from "@/components/ui/control-group";
import { ControlledTextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";

import type { Entity, World } from "koota";

type SceneMotionSettingsProps = { selection: Entity[] };

/** The scene's music: its first audio clip, or failing that a video that carries sound. */
function musicClip(world: World, scene: Entity): Entity | null {
  const tree = getEntityTree(world, scene);
  const audio = tree.find((entity) => entity.has(Audio) && entity.has(AssetId));
  if (audio) return audio;
  return tree.find((entity) => entity.has(Paint) && entity.get(Paint)?.value === PaintType.VIDEO && entity.has(AssetId)) ?? null;
}

/**
 * What makes the scene's motion read as smooth: motion blur, and the tempo
 * its animation is timed to. Both are the scene's own props, so what is set
 * here is what the file says and what an export does.
 */
export function SceneMotionSettings(props: SceneMotionSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const scene = () => props.selection[0]!;
  const blur = useTrait(scene, MotionBlur);
  const tempo = useTrait(scene, Tempo);
  const [detecting, setDetecting] = createSignal(false);
  const [note, setNote] = createSignal("");
  // The clip the beats were measured from, and where its beat 1 falls.
  const [downbeat, setDownbeat] = createSignal<{ clip: Entity; seconds: number } | null>(null);

  const writeBlur = (shutter: number, samples: number) => {
    editor.editProperty(scene(), "motionBlur", { shutter, samples });
  };

  const toggleBlur = (on: boolean) => {
    editor.editProperty(scene(), "motionBlur", on);
  };

  const detect = async () => {
    const clip = musicClip(world, scene());
    const asset = clip ? getAsset(world, clip.get(AssetId)?.value ?? "") : undefined;
    if (!clip || !asset) {
      setNote("Add the music to this scene first: beats are measured from its first audio clip.");
      return;
    }
    setDetecting(true);
    setNote("");
    setDownbeat(null);
    try {
      const found = await beatsAsset(asset);
      if (!(found.bpm > 0)) {
        setNote("No steady beat found in this track.");
        return;
      }
      editor.editProperty(scene(), "bpm", found.bpm);
      setNote(`${found.bpm} BPM. Beat 1 of the music is ${found.downbeat.toFixed(2)} s in.`);
      if (found.downbeat > 0.01) setDownbeat({ clip, seconds: Math.round(found.downbeat * 1000) / 1000 });
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The beats could not be measured.");
    } finally {
      setDetecting(false);
    }
  };

  // Trimming the music to its beat 1 makes the song's bars the timeline's
  // bars, so clips snapped to the ruler land on the music's beats.
  const startOnBeat = () => {
    const found = downbeat();
    if (!found) return;
    editor.editProperty(found.clip, "sourceIn", found.seconds);
    setDownbeat(null);
    setNote("The music starts on beat 1 now: its bars are the timeline's bars.");
  };

  return (
    <PanelSection title="Motion">
      <ControlRow label="Motion blur">
        <Switch checked={blur() !== undefined} onChange={toggleBlur}>
          <SwitchInput />
          <SwitchControl variant="compact">
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Switch>
      </ControlRow>
      <Show when={blur()}>
        {(settings) => (
          <>
            <ControlRow label="Shutter">
              <ControlledTextField
                value={settings().shutter}
                min={1}
                max={360}
                step={5}
                unit="deg"
                sliderEnabled
                onNumber={(value) => writeBlur(Math.max(1, Math.min(360, value)), settings().samples)}
              />
            </ControlRow>
            <ControlRow label="Samples">
              <ControlledTextField
                value={settings().samples}
                min={2}
                max={32}
                step={1}
                sliderEnabled
                onNumber={(value) => writeBlur(settings().shutter, Math.max(2, Math.min(32, Math.round(value))))}
              />
            </ControlRow>
            <ControlRow label="Playback">
              <Switch checked={blurWhilePlaying()} onChange={setBlurWhilePlaying}>
                <SwitchInput />
                <SwitchControl variant="compact">
                  <SwitchThumb variant="compact" />
                </SwitchControl>
              </Switch>
            </ControlRow>
            <p class="px-1 pb-1 text-xxs leading-relaxed text-muted-foreground">
              Shown while paused and scrubbing, and while playing when Playback is on. Exports always blur, and take about {settings().samples}× as long.
            </p>
          </>
        )}
      </Show>

      <ControlRow label="Tempo">
        <ControlledTextField
          value={tempo()?.bpm ?? 0}
          min={0}
          max={300}
          step={0.5}
          unit="bpm"
          onNumber={(value) => editor.editProperty(scene(), "bpm", value > 0 ? value : false)}
        />
      </ControlRow>
      <Show when={tempo()}>
        {(settings) => (
          <ControlRow label="Beats/bar">
            <ControlledTextField
              value={settings().meter}
              min={1}
              max={12}
              step={1}
              onNumber={(value) => editor.editProperty(scene(), "meter", Math.max(1, Math.round(value)))}
            />
          </ControlRow>
        )}
      </Show>
      <div class="px-1 pt-1">
        <Button variant="outline" class="w-full" disabled={detecting()} onClick={() => void detect()}>
          {detecting() ? "Listening…" : "Detect beats from the music"}
        </Button>
      </div>
      <Show when={note()}>
        <p class="px-1 pt-2 text-xxs leading-relaxed text-muted-foreground">{note()}</p>
      </Show>
      <Show when={downbeat()}>
        <div class="px-1 pt-2">
          <Button variant="outline" class="w-full" onClick={startOnBeat}>
            Start the music on beat 1
          </Button>
        </div>
      </Show>
    </PanelSection>
  );
}
