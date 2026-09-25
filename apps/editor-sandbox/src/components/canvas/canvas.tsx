/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@posterract/koota-solid";
import { findSceneAt, screenToWorld, worldToLocal, Library, Root } from "@posterract/video-runtime";
import { CameraController, EngineCanvas } from "@/engine";
import { insertAsset } from "@/engine/insert-asset";
import { droppedFiles, importFiles } from "@/engine/asset-actions";
import { insertMediaAsScenes, insertSounds, isFrameable } from "@/engine/new-scene";
import { Toolbar } from "./toolbar";
import { DrawOverlay } from "./draw-overlay";
import { toast } from "somoto"
import { SkillDeck } from "./skill-deck";
import { VoiceBar } from "@/components/shell/voice-bar";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";

import type { Asset } from "@posterract/video-assets";

export function Canvas() {
  const world = useWorld();

  /**
   * Drops onto the canvas: library assets (dragged from the panel) land where
   * they were dropped, in the scene under the pointer; external files are
   * imported into the library first, then land the same way.
   *
   * With no scene under the pointer a picture or a video becomes a scene of
   * its own, sized to it and centered where it was dropped, and sound joins
   * the scene being worked on; anything else lands loose on the stage, like an
   * element drawn there (see DrawOverlay).
   */
  const handleDropEvent = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const library = world.get(Library);
    if (!library) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const worldPt = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const scene = findSceneAt(world, worldPt.x, worldPt.y);
    const parent = scene ?? world.get(Root)!;
    const localPt = scene ? worldToLocal(world, scene, worldPt.x, worldPt.y) : worldPt;

    const place = (asset: Asset) => {
      const size = 'width' in asset && 'height' in asset ? { width: asset.width, height: asset.height } : { width: 500, height: 150 };
      const placed = insertAsset(world, asset, {
        parent,
        x: localPt.x - size.width / 2,
        y: localPt.y - size.height / 2,
      });
      if (!placed) toast("Nothing to insert into", { description: "Open a project first." });
    };

    // Read the transfer before the first await: it is gone by the time an
    // import resolves.
    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    const files = droppedFiles(event);

    const assets = assetIds.map((id) => library.get(id)).filter((asset) => asset != null);
    if (files.length) assets.push(...await importFiles(library, files, ''));

    const media = scene ? [] : assets.filter(isFrameable);
    const sounds = scene ? [] : assets.filter((asset) => asset.type === 'AUDIO');
    const handled = new Set<Asset>([...media, ...sounds]);
    for (const asset of assets) {
      if (!handled.has(asset)) place(asset);
    }
    // The camera stays where the user dropped it.
    const framed = insertMediaAsScenes(world, media, worldPt, { focus: () => {} });
    if (framed.length < media.length || !insertSounds(world, sounds)) {
      toast("Nothing to insert into", { description: "Open a project first." });
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="posterract-canvas-workspace relative size-full">
      <div
        class="absolute inset-0"
        on:drop={handleDropEvent}
        on:dragover={handleDragOver}
      >
        <Toolbar />
        <DrawOverlay />
        <EngineCanvas />
        <CameraController />
        <SkillDeck />
        <VoiceBar />
      </div>
    </div>
  );
}
