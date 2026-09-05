/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Skill Deck: a fan of cards around a scene, one per skill folder, from
 * which the scene picks what kind of video it is.
 *
 * It opens when a scene is created and from the scene's own chip. The cards
 * are laid out in screen space around the scene's frame — the frame is the
 * thing being decided about, so the deck stays anchored to it as the camera
 * moves — and choosing a card writes `skill="…"` into the scene's source.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';
import { Name, RenderSurface, entityQuad } from '@posterract/video-runtime';
import { useProject } from '@/context/project';
import { useDerived } from '@/engine/hooks';
import { closeSkillDeck, installSkill, sceneSkillName, skillDeckScene } from '@/engine/skill-deck';
import {
	addSkillFolder, formatDuration, missingKeys, refreshSkills, sigilFor, skillCards, skillsLoading,
	type SkillCard,
} from '@/lib/skills';
import { Icon } from '@/components/ui/icon';

const CARD_WIDTH = 176;
const CARD_HEIGHT = 250;
/** How many cards the arc holds; the rest go to the strip below. */
const ARC_CAPACITY = 7;
const ARC_SPAN_DEGREES = 112;
const FLY_MS = 280;

type Rect = { x: number; y: number; width: number; height: number };

type Placed = {
	card: SkillCard | null;
	kind: 'skill' | 'blank' | 'add';
	left: number;
	top: number;
	angle: number;
	/** Where the card starts its entrance from, relative to its resting place. */
	fromX: number;
	fromY: number;
	index: number;
};

export function SkillDeck() {
	const world = useWorld();
	const project = useProject();
	const scene = skillDeckScene;

	let host: HTMLDivElement | undefined;
	let searchInput: HTMLInputElement | undefined;

	const [query, setQuery] = createSignal('');
	const [hovered, setHovered] = createSignal<string | null>(null);
	const [flying, setFlying] = createSignal<string | null>(null);
	const [hostSize, setHostSize] = createSignal({ width: 0, height: 0 });

	createEffect(() => {
		const dir = project.dir();
		if (dir && scene()) void refreshSkills(dir);
	});

	createEffect(() => {
		if (!scene()) {
			setQuery('');
			setHovered(null);
			setFlying(null);
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeSkillDeck();
			} else if (event.key === '/' && document.activeElement !== searchInput) {
				event.preventDefault();
				searchInput?.focus();
			} else if (event.key === 'Enter' && document.activeElement === searchInput) {
				const first = placed().find((item) => item.kind === 'skill');
				if (first?.card) choose(first);
			}
		};
		window.addEventListener('keydown', onKey);
		onCleanup(() => window.removeEventListener('keydown', onKey));
		queueMicrotask(() => searchInput?.focus());
	});

	createEffect(() => {
		if (!scene() || !host) return;
		const observer = new ResizeObserver(() => {
			if (host) setHostSize({ width: host.clientWidth, height: host.clientHeight });
		});
		observer.observe(host);
		setHostSize({ width: host.clientWidth, height: host.clientHeight });
		onCleanup(() => observer.disconnect());
	});

	/** The scene's frame in the workspace's own pixels, refreshed as the camera moves. */
	const frame = useDerived<Rect | null>(
		() => {
			const target = scene();
			if (!target || !target.isAlive()) return null;
			const resolution = world.get(RenderSurface)?.resolution ?? 1;
			const points = [...entityQuad(world, target)];
			if (!points.length) return null;
			const xs = points.map((point) => point.x / resolution);
			const ys = points.map((point) => point.y / resolution);
			const x = Math.min(...xs);
			const y = Math.min(...ys);
			return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
		},
		(a, b) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height),
	);

	const sceneLabel = () => scene()?.get(Name)?.value?.trim() || 'this scene';
	const currentSkill = () => sceneSkillName(scene());

	const matching = createMemo(() => {
		const needle = query().trim().toLowerCase();
		const cards = skillCards();
		if (!needle) return cards;
		return cards.filter((card) =>
			[card.title, card.name, card.description, ...card.tags].join(' ').toLowerCase().includes(needle),
		);
	});

	/** The cards on the arc and where each one rests. */
	const placed = createMemo<Placed[]>(() => {
		const rect = frame();
		const size = hostSize();
		if (!rect || !size.width) return [];

		const cx = rect.x + rect.width / 2;
		const cy = rect.y + rect.height / 2;
		const entries: Array<{ card: SkillCard | null; kind: Placed['kind'] }> = [
			...matching().slice(0, ARC_CAPACITY).map((card) => ({ card, kind: 'skill' as const })),
			{ card: null, kind: 'blank' as const },
			{ card: null, kind: 'add' as const },
		];

		// The arc radius: about the scene's height, but never so large that the
		// cards leave the workspace above or beside it.
		let radius = Math.max(220, Math.min(rect.height * 0.85, 440));
		radius = Math.min(radius, cy - CARD_HEIGHT / 2 - 16);
		radius = Math.max(radius, rect.width / 2 + CARD_WIDTH * 0.25);

		const count = entries.length;
		const span = (ARC_SPAN_DEGREES * Math.PI) / 180;
		const step = count > 1 ? span / (count - 1) : 0;
		const start = -Math.PI / 2 - span / 2;

		return entries.map((entry, index) => {
			const angle = start + step * index;
			const centerX = cx + Math.cos(angle) * radius;
			const centerY = cy + Math.sin(angle) * radius;
			// Cards near the sides tilt along the arc; the top one stands straight.
			const tilt = ((angle + Math.PI / 2) * 180) / Math.PI * 0.55;
			const left = Math.max(8, Math.min(size.width - CARD_WIDTH - 8, centerX - CARD_WIDTH / 2));
			const top = Math.max(8, Math.min(size.height - CARD_HEIGHT - 8, centerY - CARD_HEIGHT / 2));
			return {
				card: entry.card,
				kind: entry.kind,
				left,
				top,
				angle: tilt,
				fromX: cx - (left + CARD_WIDTH / 2),
				fromY: cy - (top + CARD_HEIGHT / 2),
				index,
			};
		});
	});

	const overflow = createMemo(() => matching().slice(ARC_CAPACITY));

	const searchPosition = createMemo(() => {
		const rect = frame();
		const items = placed();
		if (!rect) return { left: 0, top: 0 };
		const top = items.length ? Math.min(...items.map((item) => item.top)) - 52 : rect.y - 60;
		return { left: rect.x + rect.width / 2 - 160, top: Math.max(8, top) };
	});

	const choose = (item: Placed) => {
		const target = scene();
		if (!target || flying()) return;

		if (item.kind === 'add') {
			void addSkillFolder(project.dir() ?? null)
				.then((card) => {
					if (card) toast(`Added ${card.title}`, { description: 'It is in your skill library now.' });
				})
				.catch((error: Error) => toast.error('Could not add that folder', { description: error.message }));
			return;
		}

		if (item.kind === 'blank') {
			if (currentSkill()) installSkill(world, target, null);
			closeSkillDeck();
			return;
		}

		const card = item.card!;
		const missing = missingKeys(card);
		if (missing.length) {
			toast(`${card.title} needs a ${missing.join(' and ')} key`, {
				description: 'Paste it under AI Generate → Keys before running the skill.',
			});
		}

		installSkill(world, target, card);
		setFlying(card.id);
		setTimeout(() => {
			setFlying(null);
			closeSkillDeck();
		}, FLY_MS);
	};

	const chooseCard = (card: SkillCard) => {
		const item = placed().find((entry) => entry.card?.id === card.id) ?? {
			card, kind: 'skill' as const, left: 0, top: 0, angle: 0, fromX: 0, fromY: 0, index: 0,
		};
		choose(item);
	};

	const flyStyle = (item: Placed) => {
		const rect = frame();
		if (!rect || flying() !== item.card?.id) return {};
		return {
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			transform: 'rotate(0deg)',
			opacity: '0',
		};
	};

	return (
		<Show when={scene() && frame()}>
			<div ref={host} class="posterract-deck" data-flying={flying() !== null}>
				<div class="posterract-deck-backdrop" onClick={closeSkillDeck} />

				{/* What this skill would lay out, drawn over the scene while a card is hovered. */}
				<Show when={hovered()}>
					{(id) => {
						const card = () => skillCards().find((entry) => entry.id === id());
						const rect = frame()!;
						return (
							<div
								class="posterract-deck-ghost"
								style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
							>
								<span class="posterract-deck-ghost-avatar" />
								<span class="posterract-deck-ghost-captions" />
								<span class="posterract-deck-ghost-label">{card()?.title ?? ''}</span>
							</div>
						);
					}}
				</Show>

				<div class="posterract-deck-search" style={{ left: `${searchPosition().left}px`, top: `${searchPosition().top}px` }}>
					<Icon name="search" class="size-3.5 shrink-0 opacity-60" />
					<input
						ref={searchInput}
						type="text"
						value={query()}
						placeholder={`What is ${sceneLabel()}?  Search skills…`}
						onInput={(event) => setQuery(event.currentTarget.value)}
						onClick={(event) => event.stopPropagation()}
					/>
					<Show when={skillsLoading()}>
						<span class="posterract-deck-loading" />
					</Show>
				</div>

				<For each={placed()}>
					{(item) => (
						<button
							type="button"
							class="posterract-deck-card"
							classList={{
								'is-hover': hovered() === item.card?.id,
								'is-flying': flying() === item.card?.id,
								'is-ghost': item.kind === 'blank',
								'is-add': item.kind === 'add',
								'is-current': !!item.card && item.card.name === currentSkill(),
								'is-missing': !!item.card && missingKeys(item.card).length > 0,
							}}
							style={{
								left: `${item.left}px`,
								top: `${item.top}px`,
								width: `${CARD_WIDTH}px`,
								height: `${CARD_HEIGHT}px`,
								'--rot': `${item.angle}deg`,
								'--from-x': `${item.fromX}px`,
								'--from-y': `${item.fromY}px`,
								'animation-delay': `${item.index * 40}ms`,
								...flyStyle(item),
							}}
							onMouseEnter={() => setHovered(item.card?.id ?? null)}
							onMouseLeave={() => setHovered(null)}
							onClick={(event) => {
								event.stopPropagation();
								choose(item);
							}}
						>
							<Show when={item.kind === 'skill'}>
								<SkillCover card={item.card!} />
								<div class="posterract-deck-body">
									<div class="posterract-deck-name">{item.card!.title}</div>
									<div class="posterract-deck-desc">{item.card!.description || 'A skill folder with a SKILL.md.'}</div>
									<div class="posterract-deck-chips">
										<Show when={item.card!.format}><span>{item.card!.format}</span></Show>
										<Show when={formatDuration(item.card!.duration)}>{(text) => <span>{text()}</span>}</Show>
										<Show when={item.card!.hasStarter}><span>starter</span></Show>
										<For each={missingKeys(item.card!)}>{(key) => <span class="is-warn">needs {key}</span>}</For>
										<Show when={item.card!.source === 'project'}><span>this project</span></Show>
									</div>
								</div>
							</Show>
							<Show when={item.kind === 'blank'}>
								<div class="posterract-deck-body posterract-deck-body-center">
									<div class="posterract-deck-name">Blank scene</div>
									<div class="posterract-deck-desc">
										{currentSkill() ? 'Remove the skill and start empty.' : 'Start empty. Press the chip on the scene to pick a skill later.'}
									</div>
								</div>
							</Show>
							<Show when={item.kind === 'add'}>
								<div class="posterract-deck-body posterract-deck-body-center">
									<span class="posterract-deck-plus">+</span>
									<div class="posterract-deck-name">Add skill folder…</div>
									<div class="posterract-deck-desc">Any folder with a SKILL.md. It is copied into your library.</div>
								</div>
							</Show>
						</button>
					)}
				</For>

				<Show when={overflow().length}>
					<div class="posterract-deck-strip" style={{ top: `${Math.max(...placed().map((item) => item.top + CARD_HEIGHT)) + 16}px` }}>
						<For each={overflow()}>
							{(card) => (
								<button
									type="button"
									class="posterract-deck-mini"
									onMouseEnter={() => setHovered(card.id)}
									onMouseLeave={() => setHovered(null)}
									onClick={(event) => {
										event.stopPropagation();
										chooseCard(card);
									}}
								>
									<SkillCover card={card} small />
									<span>{card.title}</span>
								</button>
							)}
						</For>
					</div>
				</Show>

				<div class="posterract-deck-hint">Esc closes · / searches · a folder dropped on a scene installs it</div>
			</div>
		</Show>
	);
}

/** A skill's face: its cover art, or the sigil drawn for it, with the logo badge in the corner. */
export function SkillCover(props: { card: SkillCard; small?: boolean }) {
	const sigil = () => sigilFor(props.card.name);
	return (
		<div class="posterract-deck-cover" classList={{ 'is-small': props.small, 'is-cyan': sigil().tone === 'cyan' }}>
			<Show
				when={props.card.cover}
				fallback={
					<div class="posterract-sigil" style={{ '--cut': `${Math.round(sigil().cut * 100)}%`, '--tilt': `${sigil().tilt}deg` }}>
						<i />
						<b>{sigil().monogram}</b>
					</div>
				}
			>
				{(cover) => <img src={cover()} alt="" draggable={false} />}
			</Show>
			<Show when={props.card.logo}>{(logo) => <img class="posterract-deck-logo" src={logo()} alt="" draggable={false} />}</Show>
		</div>
	);
}
