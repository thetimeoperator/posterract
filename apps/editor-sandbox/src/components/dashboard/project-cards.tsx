/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cx } from "@/lib/cva";

import type { JSX } from "solid-js";

type CardButtonProps = {
  active?: boolean;
  onClick?(): void;
  onDoubleClick?(): void;
  onEscape?(): void;
  onDelete?(): void;
  children: JSX.Element;
  class?: string;
};

export function DashboardCardButton(props: CardButtonProps) {
  const handleKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      const activate = props.onDoubleClick ?? props.onClick;
      if (!activate) return;
      event.preventDefault();
      activate();
    } else if (event.key === " ") {
      if (!props.onClick) return;
      event.preventDefault();
      props.onClick();
    } else if (event.key === "Escape") {
      if (!props.onEscape) return;
      event.preventDefault();
      props.onEscape();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      if (!props.onDelete) return;
      event.preventDefault();
      props.onDelete();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onDblClick={props.onDoubleClick}
      onKeyDown={handleKeyDown}
      class={cx(
        "flex min-w-0 flex-col gap-3 rounded-xl px-2 pt-2 pb-3 text-left outline-none transition-colors hover:bg-accent/50 focus-ring group",
        props.active && "bg-primary/15 hover:bg-primary/15 ring-1 ring-inset ring-primary",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

export function DashboardCardPreview(props: { children?: JSX.Element; class?: string }) {
  return (
    <div class={cx("bg-canvas relative aspect-video w-full overflow-hidden rounded-md border border-border", props.class)}>
      {props.children}
    </div>
  );
}

export function DashboardCardMeta(props: { title: string; subtitle?: string }) {
  const hasSubtitle = () => props.subtitle !== undefined;
  return (
    <div class="flex flex-col gap-1 px-2">
      <p class="min-w-0 truncate text-xs text-foreground">{props.title}</p>
      <p
        class="min-w-0 truncate text-xs text-muted-foreground"
        classList={{ "opacity-0": !hasSubtitle() }}
        aria-hidden={hasSubtitle() ? undefined : "true"}
      >
        {props.subtitle ?? "\u00a0"}
      </p>
    </div>
  );
}

export function DashboardViewSection(props: {
  title: string;
  controls: JSX.Element;
  children: JSX.Element;
  class?: string;
  onBackgroundClick?(): void;
}) {
  const handleClick: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent> = (event) => {
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.dataset.slot !== "card-grid") return;
    props.onBackgroundClick?.();
  };

  return (
    <div class={cx("flex min-h-0 flex-1 flex-col gap-3 pt-4", props.class)}>
      <div class="flex items-end gap-6 px-6">
        <h1 class="min-w-0 flex-1 text-2xl leading-6 font-450 text-foreground">{props.title}</h1>
        {props.controls}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4" onClick={handleClick}>
        <div
          data-slot="card-grid"
          class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start items-start gap-x-0.5 gap-y-3"
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
