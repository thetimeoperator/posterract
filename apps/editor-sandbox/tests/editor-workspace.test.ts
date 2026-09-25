import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from 'koota';
import { Active, Animation, ChildOf, Computed, Expanded, Geometry, Group, ItemIndex, KeyframeTrack, Live, Paint, Scene, Sequential, Stagger, Timeline } from '../../../packages/posterract-video-runtime/src/traits';
import { buildTimelineLayers } from '../../../packages/posterract-video-runtime/src/queries/timeline-index';
import { getLocalWindow, getStaggerOffset } from '../../../packages/posterract-video-runtime/src/utils/time';
import { workspaceFit } from '../src/engine/workspace-fit';
import { zoomTimelineIn, zoomTimelineOut, zoomTimelineToFit } from '../src/engine/timeline/zoom';
import { TimelineSurface } from '../src/engine/timeline/surface';
import { addCalendarDays, startOfWeek, calendarDayKey, scheduleTimeForDay, localDateTimeValue } from '../../web/src/lib/calendar-date';

test('portrait preview stays inside the actual remaining workspace', () => {
  const fit = workspaceFit({ x: 500, y: 120, width: 1080, height: 1920 }, { width: 1440, height: 900 }, { left: 304, right: 304, top: 116, bottom: 280 })!;
  const left = fit.e + 500 * fit.a;
  const top = fit.f + 120 * fit.d;
  assert.ok(left >= 328 && top >= 140);
  assert.ok(left + 1080 * fit.a <= 1112);
  assert.ok(top + 1920 * fit.d <= 596);
});

test('workspace fit rejects unavailable space and invalid bounds', () => {
  const inset = { left: 200, right: 200, top: 100, bottom: 100 };
  assert.equal(workspaceFit({ x: 0, y: 0, width: 1080, height: 1920 }, { width: 400, height: 300 }, inset), null);
  assert.equal(workspaceFit({ x: 0, y: 0, width: 0, height: 1920 }, { width: 1400, height: 900 }, inset), null);
});

test('preset-only sequence clips remain expandable and reveal their animation', () => {
  const world = createWorld();
  try {
    const sequence = world.spawn(Group, Sequential, Expanded);
    const clip = world.spawn(Geometry, Expanded, ChildOf(sequence));
    const animation = world.spawn(Animation, ChildOf(clip));
    assert.equal(buildTimelineLayers(world, sequence, 'clips').length, 0);
    const nodes = buildTimelineLayers(world, sequence, 'animation');
    assert.equal(nodes[0]?.entity, clip);
    assert.equal(nodes[0]?.children[0]?.entity, animation);
    assert.equal(nodes[0]?.children[0]?.kind, 'animation');
  } finally { world.destroy(); }
});

test('direct sequence keyframes, live props, and static paints appear at their respective detail levels', () => {
  const world = createWorld();
  try {
    const sequence = world.spawn(Group, Sequential, Expanded);
    const track = world.spawn(KeyframeTrack, ChildOf(sequence));
    const clip = world.spawn(Geometry, Expanded, Live({ props: 'x,opacity' }), ChildOf(sequence));
    const paint = world.spawn(Paint, ChildOf(clip));
    assert.ok(buildTimelineLayers(world, sequence, 'clips').some((node) => node.entity === track));
    const motion = buildTimelineLayers(world, sequence, 'animation').find((node) => node.entity === clip)!;
    assert.equal(motion.children[0]?.kind, 'live');
    assert.ok(!motion.children.some((node) => node.entity === paint));
    const all = buildTimelineLayers(world, sequence, 'everything').find((node) => node.entity === clip)!;
    assert.ok(all.children.some((node) => node.entity === paint && node.kind === 'paint'));
  } finally { world.destroy(); }
});

test('motion windows use local time and nested stagger clocks', () => {
  const world = createWorld();
  try {
    const root = world.spawn(Group, Stagger({ value: 3 }));
    const row = world.spawn(Group, Stagger({ value: 5 }), ItemIndex({ value: 2 }), ChildOf(root));
    const clip = world.spawn(Geometry, Computed({ start: 100, end: 160, origin: 90, playbackRate: 2 }), ItemIndex({ value: 4 }), ChildOf(row));
    assert.deepEqual(getLocalWindow(clip), { in: 20, out: 140 });
    assert.equal(getStaggerOffset(clip), 26);
  } finally { world.destroy(); }
});

// These tests read only timeline data; they never construct or draw a DOM matrix.
test('zoom enlarges clips while retaining the playhead, and fit uses the active scene', () => {
	// Koota constructs default fields even when the fixture supplies values.
	const priorMatrix = globalThis.DOMMatrix;
	const priorRect = globalThis.DOMRect;
	globalThis.DOMMatrix = class {} as typeof DOMMatrix;
	globalThis.DOMRect = class {} as typeof DOMRect;
  const world = createWorld();
  try {
    const scene = world.spawn(Scene, Active, Computed({ localTime: 100, duration: 300 }), Timeline({ resolution: 2, scrollX: 20, transform: {} as DOMMatrix }));
    world.spawn(Scene, Computed({ duration: 9000 }));
    world.add(TimelineSurface({ layout: { width: 636 } as DOMRect } as never));
    zoomTimelineIn(world);
    assert.equal(scene.get(Timeline)?.resolution, 2.8);
    assert.ok(Math.abs((100 - scene.get(Timeline)!.scrollX) * 2.8 - 160) < 0.00001);
    zoomTimelineOut(world);
    assert.equal(scene.get(Timeline)?.resolution, 2);
    zoomTimelineToFit(world);
    assert.equal(scene.get(Timeline)?.resolution, 2);
  } finally { world.destroy(); globalThis.DOMMatrix = priorMatrix; globalThis.DOMRect = priorRect; }
});

test('calendar date stepping crosses both DST changes without duplicate or shifted days', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    for (const start of [new Date(2026, 2, 2).getTime(), new Date(2026, 9, 26).getTime()]) {
      const days = Array.from({ length: 14 }, (_, index) => addCalendarDays(start, index));
      assert.equal(new Set(days.map(calendarDayKey)).size, 14);
      assert.ok(days.every((day) => new Date(day).getHours() === 0));
      assert.equal(startOfWeek(days[6]!), start);
      assert.equal(startOfWeek(days[7]!), days[7]);
    }
    assert.equal(addCalendarDays(new Date(2026, 2, 8).getTime(), 1) - new Date(2026, 2, 8).getTime(), 23 * 3600_000);
    assert.equal(addCalendarDays(new Date(2026, 10, 1).getTime(), 1) - new Date(2026, 10, 1).getTime(), 25 * 3600_000);
    assert.equal(localDateTimeValue(scheduleTimeForDay(new Date(2026, 2, 8).getTime(), 0)), '2026-03-08T12:00');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
