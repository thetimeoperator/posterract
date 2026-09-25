/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createResource } from 'solid-js';
import { Navigate, useNavigate } from '@solidjs/router';
import { EditorPage } from './editor';
import { AiProvider } from "@/context/ai";
import { LayoutProvider } from "@/context/layout";
import { EditorApiProvider } from '@/context/agent-api';
import { ExportProvider } from '@/context/export';
import { ProjectProvider } from '@/context/project';
import { projectRoute, useProjectRef } from '@/hooks/use-project-route';
import { resolveProject } from '@/projects';
import { TimelineProvider } from '@/context/timeline';
import { EngineProvider } from '@/engine';

/** `/projects/*ref` — the editor, with the project `ref` names loaded. */
export function ProjectPage() {
  const ref = useProjectRef();
  const navigate = useNavigate();

  // The ref the project was found for. Rewriting the URL to the id below
  // changes the ref without changing the project, so the lookup is held on
  // what it already answered rather than run again — refetching would tear
  // the editor down and build it back for the project already in it.
  let resolvedId = '';
  const target = createMemo<string>((previous) => {
    const next = ref();
    return previous && next === resolvedId ? previous : next;
  }, '');

  // Which folder that is, is main's to answer: the URL carries the project's
  // id, and the folder it names can be renamed out from under the link.
  const [project] = createResource(target, resolveProject);

  // The id is the project's address. A URL that named the folder (a link from
  // before ids, a bookmark from before a rename) is swapped for the canonical
  // one, so the next rename leaves it alone.
  createEffect(() => {
    // While another project is being looked up, `project()` is still the one
    // before it. Acting on that was the bug: opening B from A ran this with A,
    // found that A's id was not the URL, and "corrected" the URL back to A —
    // under which B then opened. Between two projects with ids the next run put
    // it right; a folder with no id of its own (a hand-made project, one the
    // engine was pointed at) has nothing to correct it with, so the URL stayed
    // A's, and going back to A was then a change to the URL it already had:
    // nothing happened, and the editor stayed on B.
    if (project.loading) return;
    const found = project();
    if (!found) return;
    // The id of the project that is open now; a folder without one holds nothing.
    resolvedId = found.id || '';
    if (found.id && found.id !== ref()) navigate(projectRoute(found.id), { replace: true });
  });

  return (
    /**
     * keyed so the engine provider is remounted when the project changes —
     * on the project, not on its folder: renaming one must not tear down the
     * world the user is working in.
     */
    <Show when={!project.loading}>
      <Show when={project()} keyed fallback={<Navigate href="/" />}>
        {(found) => (
          <ProjectProvider project={found}>
            <EngineProvider projectId={found.id}>
              <EditorApiProvider>
                <TimelineProvider>
                  <ExportProvider>
                    <AiProvider dir={() => project()?.dir}>
                      <LayoutProvider>
                        <EditorPage />
                      </LayoutProvider>
                    </AiProvider>
                  </ExportProvider>
                </TimelineProvider>
              </EditorApiProvider>
            </EngineProvider>
          </ProjectProvider>
        )}
      </Show>
    </Show>
  )
}
