/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The asset library's view of a project folder on desktop: the main process
// reads and writes the manifest (as YAML) and lists and stats files; bytes
// come in as real Files (see ElectronFileHandle) and go out through the
// streaming FILE_WRITE_* channels.

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { isAbsoluteSource } from '@posterract/video-assets';

import type { Manifest, ProjectFS } from '@posterract/video-assets';

async function readFile(dir: string, source: string): Promise<File> {
	const result = await mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_FILE, { dir, source });
	const blob = result.blob ?? (result.url ? await fetch(result.url).then((response) => {
		if (!response.ok) throw new Error(`Could not load ${source}: ${response.status}`);
		return response.blob();
	}) : undefined);
	if (!blob) throw new Error(`Could not load ${source}`);
	return new File([blob], result.name, {
		type: result.mimeType || blob.type,
		lastModified: result.mtime,
	});
}

/** The `ProjectFS` of the project folder at `dir`. */
export function createProjectFS(dir: string): ProjectFS {
	const separator = dir.includes('\\') ? '\\' : '/';
	const absolute = (source: string): string =>
		isAbsoluteSource(source) ? source : `${dir}${separator}${source.split('/').join(separator)}`;

	return {
		absolute,
		readManifest: () => mainBridge.call(MAIN_CHANNELS.PROJECTS_MANIFEST_READ, { dir }),
		writeManifest: (manifest: Manifest) => mainBridge.call(MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE, { dir, manifest }),
		list: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_LIST, { dir, source }),
		stat: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_STAT, { dir, source }),
		file: (source) => readFile(dir, source),
		write: (path, blob) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_WRITE, { dir, path, blob }),
		copy: (source, path) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_COPY, { dir, source, path }),
		remove: (path) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_REMOVE, { dir, path }),
		realPath: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_REAL_PATH, { dir, source }),
		pathOf: (file) => window.desktop?.getPathForFile(file) || null,
	};
}
