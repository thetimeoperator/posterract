/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { HashRouter, Route } from "@solidjs/router";
import { ColorModeProvider } from "@kobalte/core";
import { Toaster } from "@/components/ui/sonner";
import { DashboardProjectsView } from "@/components/dashboard/projects-view";
import { ProjectPage } from "@/pages/project";
import { EditorApi } from "@/context/agent-api";
import { posterractIcon } from "@/assets/brand";

function ProjectsRoot() {
  const backToPosterract = () => {
    window.parent.postMessage({ type: "posterract-editor-navigate", path: "/continuum" }, "*");
  };

  return (
    <main class="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-sidebar">
      <header
        class="flex h-16 shrink-0 items-end gap-3 border-b border-border px-5 pb-3 [[data-platform=darwin]_&]:pl-20"
        style="-webkit-app-region: drag;"
      >
        <img
          src={posterractIcon}
          alt=""
          class="size-8 shrink-0 rounded-lg object-cover shadow-[0_0_18px_rgba(96,246,177,0.12)]"
        />
        <div class="min-w-0 flex-1">
          <p class="text-xxs font-semibold tracking-[0.18em] text-primary">POSTERRACT CREATE</p>
          <h1 class="truncate text-base font-500 text-foreground">Projects</h1>
        </div>
        <button
          type="button"
          class="h-8 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          style="-webkit-app-region: no-drag;"
          onClick={backToPosterract}
        >
          Back to Posterract
        </button>
      </header>
      <DashboardProjectsView />
    </main>
  );
}

export default function App() {
  return (
    <ColorModeProvider initialColorMode="dark">
      <HashRouter>
        <EditorApi />
        <Route path="/" component={ProjectsRoot} />
        <Route path="/projects/*ref" component={ProjectPage} />
        <Route path="*" component={ProjectsRoot} />
      </HashRouter>
      <Toaster />
    </ColorModeProvider>
  );
}
