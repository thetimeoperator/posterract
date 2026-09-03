/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// File actions on the library, with the user told how they went: the
// mechanics live in @posterract/video-assets.

import { toast } from "somoto";
import { importFiles as importFilesInto, pickFiles, saveAssetAs as saveAs } from "@posterract/video-assets";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { insertAsset } from "./insert-asset";
import { forgetAssetMedia } from "./timeline/media";
import { forgetAssetPeaks } from "./timeline/peaks";

import type { World } from "koota";

import type { Asset, AssetLibrary } from "@posterract/video-assets";

export { droppedFiles, pickFiles } from "@posterract/video-assets";

/** Saves a copy of an asset's file where the user says; reports failure. */
export async function saveAssetAs(asset: Pick<Asset, "handle" | "mimeType" | "path">): Promise<void> {
  try {
    await saveAs(asset);
  } catch (error) {
    toast.error("Failed to save", { description: (error as Error).message });
  }
}

/** Links files into the library at `folder` and reports whatever was skipped or refused. */
export async function importFiles(library: AssetLibrary, files: ReadonlyArray<File>, folder: string): Promise<Asset[]> {
  const report = await importFilesInto(library, files, folder);

  if (report.unnamed.length) {
    toast("Some files could not be imported", { description: "Only files on this computer can be added to the library." });
  }
  for (const { source, error } of report.failed) {
    toast.error(`Could not import ${source.split(/[\\/]/).pop()}`, { description: error.message });
  }
  return report.assets;
}

/** Opens the file picker and imports what the user picks into `folder`. */
export async function pickAndImport(library: AssetLibrary, folder: string): Promise<Asset[]> {
  return importFiles(library, await pickFiles(), folder);
}

/**
 * Downloads a Lottie animation from a URL into the project's
 * `assets/lottie/`.
 *
 * The fetch happens in the main process — the editor's own CSP allows no
 * network — and the file lands in the project folder, where the library
 * watcher picks it up like any other file that appeared there. Returns the
 * project-relative path it was written to, or null when it failed (the user
 * has already been told why).
 */
export async function importLottieUrl(dir: string, url: string): Promise<string | null> {
  try {
    const result = await mainBridge.call(MAIN_CHANNELS.PROJECTS_IMPORT_LOTTIE_URL, { dir, url });
    toast.success("Animation imported", { description: result.path });
    return result.path;
  } catch (error) {
    toast.error("Could not import that animation", {
      description: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Lets the user pick another file for `asset` and points it there; the JSX
 * keeps naming it by path. Returns the relinked asset, or null when the
 * picker was dismissed, the host cannot tell the file's path, or the relink
 * failed (reported).
 */
export async function replaceAssetSource(library: AssetLibrary, asset: Asset): Promise<Asset | null> {
  const [file] = await pickFiles({ multiple: false });
  const path = file ? library.fs.pathOf?.(file) : null;
  if (!path) return null;
  try {
    const relinked = await library.relink(asset, path);
    // The picture and the waveform the timeline is showing are of the file
    // it used to be.
    forgetAssetMedia(asset.id);
    forgetAssetPeaks(asset.id);
    return relinked;
  } catch (error) {
    toast.error("Failed to replace", { description: (error as Error).message });
    return null;
  }
}

/** Inserts `asset` at the playhead of the active scene; tells the user when there is nowhere to put it. */
export function insertAssetAtPlayhead(world: World, asset: Asset): void {
  if (!insertAsset(world, asset)) {
    toast("Nothing to insert into", { description: "Open a project first." });
  }
}

