/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The scene's skill, in the inspector: what it is, what it needs, the
 * recipes it offers the agent, and the way to change it.
 */
import { For, Show, createEffect, createMemo } from "solid-js";
import { toast } from "somoto";
import { useTrait, useWorld } from "@posterract/koota-solid";
import { SceneSkill } from "@posterract/video-runtime";
import { PanelSection } from "@/components/ui/panel-section";
import { Button } from "@/components/ui/button";
import { SkillCover } from "@/components/canvas/skill-deck";
import { useProject } from "@/context/project";
import { installSkill, openSkillDeck } from "@/engine/skill-deck";
import { findSkill, formatDuration, missingKeys, refreshSkills, revealSkill, skillCards, skillTitle } from "@/lib/skills";

import type { Entity } from "koota";

type SceneSkillPanelProps = { selection: Entity[] };

export function SceneSkillPanel(props: SceneSkillPanelProps) {
  const world = useWorld();
  const project = useProject();
  const entity = () => props.selection[0]!;
  const skill = useTrait(entity, SceneSkill);
  const name = createMemo(() => skill()?.value || null);
  // Resolve against the list, and fetch it if this is the first look.
  const card = createMemo(() => {
    skillCards();
    return findSkill(name());
  });

  createEffect(() => {
    const dir = project.dir();
    if (dir && name() && !skillCards().length) void refreshSkills(dir);
  });

  const copyRecipe = async (label: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast(`Copied "${label}"`, { description: "Paste it into your agent." });
    } catch {
      toast.error("Could not copy the recipe");
    }
  };

  return (
    <PanelSection
      title="Skill"
      actions={
        <Button variant="ghost" size="small" class="h-6 px-2 text-xxs text-primary" onClick={() => openSkillDeck(entity())}>
          {name() ? "Change" : "Choose"}
        </Button>
      }
    >
      <Show
        when={name()}
        fallback={
          <p class="text-xxs leading-4 text-muted-foreground">
            No skill yet. A skill tells the agent what kind of video this scene is and how to build it.
          </p>
        }
      >
        <Show
          when={card()}
          fallback={
            <div class="flex flex-col gap-2">
              <p class="text-xs text-foreground">{skillTitle(name()!)}</p>
              <p class="text-xxs leading-4 text-muted-foreground">
                This skill folder is not installed on this computer. Add it to your library to see its card.
              </p>
              <Button variant="ghost" size="small" class="h-6 self-start px-2 text-xxs text-muted-foreground" onClick={() => installSkill(world, entity(), null)}>
                Remove
              </Button>
            </div>
          }
        >
          {(found) => (
            <div class="flex flex-col gap-3">
              <div class="flex gap-3">
                <div class="w-14 shrink-0">
                  <SkillCover card={found()} small />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-450 text-foreground" title={found().title}>{found().title}</p>
                  <p class="mt-0.5 line-clamp-3 text-xxs leading-4 text-muted-foreground">{found().description}</p>
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    <Show when={found().format}><span class="posterract-chip">{found().format}</span></Show>
                    <Show when={formatDuration(found().duration)}>{(text) => <span class="posterract-chip">{text()}</span>}</Show>
                    <For each={missingKeys(found())}>{(key) => <span class="posterract-chip is-warn">needs {key}</span>}</For>
                  </div>
                </div>
              </div>

              <Show when={found().recipes.length}>
                <div class="flex flex-col gap-1">
                  <For each={found().recipes}>
                    {(recipe) => (
                      <button
                        type="button"
                        class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xxs text-foreground hover:bg-accent focus-ring"
                        onClick={() => void copyRecipe(recipe.label, recipe.prompt)}
                        title="Copy this prompt for your agent"
                      >
                        <span class="truncate">{recipe.label}</span>
                        <span class="shrink-0 text-muted-foreground">copy</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <div class="flex items-center gap-1">
                <Button variant="ghost" size="small" class="h-6 px-2 text-xxs text-muted-foreground" onClick={() => void revealSkill(found())}>
                  Open folder
                </Button>
                <Button variant="ghost" size="small" class="h-6 px-2 text-xxs text-muted-foreground" onClick={() => installSkill(world, entity(), null)}>
                  Remove
                </Button>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </PanelSection>
  );
}
