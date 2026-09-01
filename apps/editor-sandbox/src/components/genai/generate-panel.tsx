/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Generate panel: prompt-to-media over the AI bridge, opened from the
 * sidebar's brand slot the way the agent panel is. Three tabs (image, video,
 * voice) share one footer — the balance and one button that always says what
 * the click will cost. Results land in a list below and go to the canvas
 * through the same insert path an imported asset takes.
 *
 * Everything here degrades: no app shell means a quiet disabled panel, an
 * empty balance means a locked one, and a failed run says that nothing was
 * charged. The editor never checks out — upgrading lives in the Posterract
 * app.
 */

import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@posterract/koota-solid';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedIconTabs } from '@/components/ui/segmented-icon-tabs';
import {
	Select,
	SelectContent,
	SelectIconTrigger,
	SelectItem,
	SelectPortal,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { SliderInput } from '@/components/ui/slider-input';
import { TextField, TextFieldTextArea } from '@/components/ui/text-field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAi } from '@/context/ai';
import {
	estimateCredits,
	IMAGE_RESOLUTIONS,
	VIDEO_ASPECTS,
	VIDEO_DURATION,
	VIDEO_QUALITIES,
	videoQualityLabel,
	voiceCredits,
} from '@/lib/ai-bridge';
import { insertGeneration } from './insert-generation';

import type { AiGenerationRow } from '@/context/ai';
import type {
	AiGenerationKind,
	AiGenerationRequest,
	ImageResolution,
	VideoAspect,
	VideoQuality,
} from '@/lib/ai-bridge';

/**
 * A few named voices to start from. The ids are opaque strings the shell
 * passes through to the provider; this list is a placeholder until the shell
 * serves a real catalog.
 */
const FISH_VOICES: ReadonlyArray<{ id: string; label: string }> = [
	{ id: 'b545c585f631496c914815bd8a0dffe1', label: 'Aria — bright narrator' },
	{ id: '728f6ff2240d49308e8593ffdb8b21bd', label: 'Marlow — calm and low' },
	{ id: 'e58b0d7efca34eb38d5c4985e378abcb', label: 'Juniper — warm, conversational' },
	{ id: '4ce7e917cedd4bc2bb2e6ff3a46acaa1', label: 'Atlas — deep announcer' },
];

const TAB_ITEMS = [
	{ value: 'image', label: 'Image' },
	{ value: 'video', label: 'Video' },
	{ value: 'voice', label: 'Voice' },
] as const;

const ASPECT_ICONS: Record<VideoAspect, string> = {
	'9:16': 'aspect-ratio-9-16',
	'16:9': 'aspect-ratio-16-9',
	'1:1': 'aspect-ratio-1-1',
	'4:3': 'aspect-ratio-4-3',
	'3:4': 'aspect-ratio-3-4',
};

const formatCredits = (credits: number) => `${credits.toLocaleString()} cr`;

// The drafts live at module scope (the way context/render keeps its overlay):
// the popover unmounts its content when it closes, and an accidental outside
// click must not eat a prompt someone was still writing.
const [tab, setTab] = createSignal<AiGenerationKind>('image');

const [imagePrompt, setImagePrompt] = createSignal('');
const [imageAspect, setImageAspect] = createSignal<VideoAspect>('1:1');
const [imageResolution, setImageResolution] = createSignal<ImageResolution>('1K');

const [videoPrompt, setVideoPrompt] = createSignal('');
const [videoAspect, setVideoAspect] = createSignal<VideoAspect>('9:16');
const [videoDuration, setVideoDuration] = createSignal(6);
const [videoQuality, setVideoQuality] = createSignal<VideoQuality>('768P');

const [voiceText, setVoiceText] = createSignal('');
const [voiceId, setVoiceId] = createSignal(FISH_VOICES[0]!.id);

const resetDateLabel = (iso: string | null | undefined): string | null => {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
};

/** The sidebar's Generate entry: the brand toggle plus the panel it opens. */
export function GenerateLauncher() {
	const ai = useAi();
	const [open, setOpen] = createSignal(false);

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		// The balance and the history are the shell's; every open re-reads them.
		if (next) void ai.hydrate();
	};

	return (
		<Popover open={open()} onOpenChange={handleOpenChange} placement="right-start" gutter={12}>
			<PopoverTrigger
				class="posterract-code-toggle posterract-generate-toggle"
				classList={{ 'is-active': open() }}
				aria-label="Generate media with AI"
			>
				<span>AI</span>
				Generate
				<Icon name="ai-generate" class="ml-auto size-4 shrink-0 opacity-70" />
			</PopoverTrigger>
			{/* Portaled: the sidebar clips overflow, and this panel opens past its edge. */}
			<PopoverPortal>
				<PopoverContent class="w-[380px] p-0 overflow-hidden">
					<GeneratePanel />
				</PopoverContent>
			</PopoverPortal>
		</Popover>
	);
}

function GeneratePanel() {
	const ai = useAi();

	const request = createMemo<AiGenerationRequest>(() => {
		switch (tab()) {
			case 'image':
				return { kind: 'image', prompt: imagePrompt().trim(), aspectRatio: imageAspect(), resolution: imageResolution() };
			case 'video':
				return { kind: 'video', prompt: videoPrompt().trim(), aspectRatio: videoAspect(), durationSec: videoDuration(), quality: videoQuality() };
			case 'voice':
				return { kind: 'voice', text: voiceText(), voiceId: voiceId() };
		}
	});

	const price = createMemo(() => estimateCredits(request()));

	const empty = createMemo(() => {
		const current = request();
		return current.kind === 'voice' ? current.text.trim().length === 0 : current.prompt.length === 0;
	});

	const connected = () => ai.availability() === 'connected';
	const canGenerate = () => connected() && !ai.lock() && !ai.busy() && !empty() && price() > 0;

	const submit = async () => {
		if (!canGenerate()) return;
		try {
			await ai.generate(request());
		} catch (error) {
			// Only a run that never made it to a row reports here (the quote).
			toast.error('Could not start the generation', {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return (
		<div class="flex max-h-[calc(100vh-96px)] flex-col text-foreground">
			<div class="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
				<span class="text-[12px] font-strong">Generate</span>
				<Show when={connected() && ai.credits()}>
					{(credits) => (
						<span class="ml-auto text-xxs text-muted-foreground">
							{formatCredits(credits().balance)} left
						</span>
					)}
				</Show>
			</div>

			<Switch>
				<Match when={ai.availability() === 'offline'}>
					<div class="flex items-start gap-2 border-t border-border px-4 py-4 text-xs leading-relaxed text-muted-foreground">
						<Icon name="alert-warning" class="size-4 shrink-0" />
						<span>The Posterract app didn't respond — AI features need the app shell.</span>
					</div>
				</Match>

				<Match when={ai.availability() === 'unknown'}>
					<div class="flex items-center gap-2 border-t border-border px-4 py-4 text-xs text-muted-foreground">
						<Icon name="spinner-loader" class="size-4 shrink-0 animate-spin" />
						<span>Connecting to the Posterract app…</span>
					</div>
				</Match>

				<Match when={ai.lock()}>
					{(lock) => <LockedCard balance={lock().balance} needed={lock().needed} cycleResetsAt={lock().cycleResetsAt} noPlan={lock().noPlan} />}
				</Match>

				<Match when>
					<div class="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-1">
						<SegmentedIconTabs
							value={tab}
							onChange={(next) => setTab(next as AiGenerationKind)}
							items={TAB_ITEMS}
						/>

						<Show when={tab() === 'image'}>
							<PromptField
								value={imagePrompt()}
								onInput={setImagePrompt}
								placeholder="Describe the image to generate…"
							/>
							<div class="grid grid-cols-2 gap-2">
								<AspectSelect value={imageAspect()} onChange={setImageAspect} />
								<SegmentedIconTabs
									value={imageResolution}
									onChange={(next) => setImageResolution(next as ImageResolution)}
									items={IMAGE_RESOLUTIONS.map((entry) => ({
										value: entry.value,
										label: `${entry.value} · ${entry.credits} cr`,
									}))}
								/>
							</div>
						</Show>

						<Show when={tab() === 'video'}>
							<PromptField
								value={videoPrompt()}
								onInput={setVideoPrompt}
								placeholder="Describe the video to generate…"
							/>
							<div class="grid grid-cols-2 gap-2">
								<AspectSelect value={videoAspect()} onChange={setVideoAspect} />
								<SliderInput
									value={videoDuration()}
									onChange={(next) => setVideoDuration(Math.round(next))}
									min={VIDEO_DURATION.min}
									max={VIDEO_DURATION.max}
									step={1}
									format={(value) => `${Math.round(value)}s`}
								/>
							</div>
							<SegmentedIconTabs
								value={videoQuality}
								onChange={(next) => setVideoQuality(next as VideoQuality)}
								items={VIDEO_QUALITIES.map((entry) => ({
									value: entry.value,
									label: `${entry.label} ${entry.value}`,
								}))}
							/>
							<div class="text-xxs text-muted-foreground">
								{videoDuration()}s · {videoQualityLabel(videoQuality())} — {formatCredits(price())}
							</div>
						</Show>

						<Show when={tab() === 'voice'}>
							<PromptField
								value={voiceText()}
								onInput={setVoiceText}
								placeholder="Write what the voice should say…"
							/>
							<VoiceSelect value={voiceId()} onChange={setVoiceId} />
							<div class="text-xxs text-muted-foreground">
								{voiceText().length.toLocaleString()} chars · {formatCredits(voiceCredits(voiceText().length))} at 3 cr per 1,000
							</div>
						</Show>
					</div>

					<div class="flex items-center gap-2 px-4 py-3">
						<Show when={ai.credits()}>
							{(credits) => (
								<span class="inline-flex h-5 items-center rounded bg-input px-1.5 text-xxs text-muted-foreground">
									{formatCredits(credits().balance)}
								</span>
							)}
						</Show>
						<Button class="ml-auto" disabled={!canGenerate()} onClick={() => void submit()}>
							<Show when={!ai.busy()} fallback={<>Generating…</>}>
								Generate · {formatCredits(price())}
							</Show>
						</Button>
					</div>
				</Match>
			</Switch>

			<ResultsList />
		</div>
	);
}

function PromptField(props: { value: string; onInput: (value: string) => void; placeholder: string }) {
	return (
		<TextField value={props.value} onChange={props.onInput}>
			<TextFieldTextArea
				placeholder={props.placeholder}
				class="min-h-20 max-h-40 resize-none text-xs select-text"
			/>
		</TextField>
	);
}

function AspectSelect(props: { value: VideoAspect; onChange: (value: VideoAspect) => void }) {
	return (
		<Select<VideoAspect>
			value={props.value}
			onChange={(next) => next && props.onChange(next)}
			options={[...VIDEO_ASPECTS]}
			itemComponent={(itemProps) => (
				<SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>
			)}
		>
			<SelectIconTrigger<VideoAspect>
				aria-label="Aspect ratio"
				icon={<Icon name={ASPECT_ICONS[props.value]} class="size-6" />}
			>
				{(state) => state.selectedOption()}
			</SelectIconTrigger>
			<SelectPortal>
				<SelectContent />
			</SelectPortal>
		</Select>
	);
}

function VoiceSelect(props: { value: string; onChange: (value: string) => void }) {
	const selected = () => FISH_VOICES.find((voice) => voice.id === props.value) ?? FISH_VOICES[0]!;
	return (
		<Select<{ id: string; label: string }>
			value={selected()}
			onChange={(next) => next && props.onChange(next.id)}
			options={[...FISH_VOICES]}
			optionValue="id"
			optionTextValue="label"
			itemComponent={(itemProps) => (
				<SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
			)}
		>
			<SelectTrigger aria-label="Voice">
				<SelectValue<{ id: string; label: string }>>
					{(state) => state.selectedOption()?.label}
				</SelectValue>
			</SelectTrigger>
			<SelectPortal>
				<SelectContent />
			</SelectPortal>
		</Select>
	);
}

/**
 * Generating is locked: no plan, an empty balance, or a run the balance
 * cannot cover. Checkout never happens here — the Posterract app owns it.
 */
function LockedCard(props: { balance: number; needed?: number; cycleResetsAt?: string | null; noPlan?: boolean }) {
	const resetLabel = () => resetDateLabel(props.cycleResetsAt);
	return (
		<div class="flex flex-col gap-2 border-t border-border px-4 py-4">
			<div class="flex items-center gap-2 text-xs text-foreground">
				<Icon name="lock-closed" class="size-4 shrink-0 text-muted-foreground" />
				<Show
					when={props.needed !== undefined}
					fallback={<span>{props.noPlan ? 'No plan on this account.' : 'Out of credits.'}</span>}
				>
					<span>
						Needs {formatCredits(props.needed!)} — you have {formatCredits(Math.max(0, props.balance))}.
					</span>
				</Show>
			</div>
			<div class="text-xxs leading-relaxed text-muted-foreground">
				<Show when={props.needed === undefined}>
					<span>Balance: {formatCredits(Math.max(0, props.balance))}. </span>
				</Show>
				<Show when={resetLabel()}>
					{(label) => <span>Credits reset {label()}. </span>}
				</Show>
				<span>Upgrade from Billing in the Posterract app — the editor never checks out.</span>
			</div>
		</div>
	);
}

function ResultsList() {
	const ai = useAi();
	return (
		<div class="min-h-0 flex-1 overflow-y-auto border-t border-border">
			<div class="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
				Results
			</div>
			<Show
				when={ai.generations().length > 0}
				fallback={
					<div class="px-4 pb-3 text-xxs text-muted-foreground">
						Nothing generated yet.
					</div>
				}
			>
				<div class="flex flex-col pb-2">
					<For each={ai.generations()}>{(row) => <ResultRow row={row} />}</For>
				</div>
			</Show>
		</div>
	);
}

const KIND_ICONS: Record<AiGenerationKind, string> = {
	image: 'media-image',
	video: 'video',
	voice: 'media-audio',
};

function ResultRow(props: { row: AiGenerationRow }) {
	const world = useWorld();
	const generating = () => props.row.status === 'pending' || props.row.status === 'reserved' || props.row.status === 'running';

	const addToCanvas = () => {
		const output = props.row.output;
		if (!output?.url) return;
		const entity = insertGeneration(world, props.row.kind, output);
		if (!entity) {
			toast('Nothing to insert into', { description: 'Open a scene first.' });
			return;
		}
		toast.success('Added to canvas');
	};

	return (
		<div class="flex items-start gap-2.5 px-4 py-2 hover:bg-accent/40">
			<div class="size-12 shrink-0 overflow-hidden rounded-md bg-input">
				<Switch
					fallback={
						<div class="flex size-full items-center justify-center text-muted-foreground">
							<Show when={generating()} fallback={<Icon name={KIND_ICONS[props.row.kind]} class="size-6" />}>
								<Icon name="spinner-loader" class="size-5 animate-spin" />
							</Show>
						</div>
					}
				>
					<Match when={props.row.kind === 'image' && props.row.output?.url}>
						{(url) => <img src={url()} alt="" class="size-full object-cover" />}
					</Match>
					<Match when={props.row.kind === 'video' && props.row.output?.url}>
						{(url) => <video src={url()} muted playsinline preload="metadata" class="size-full object-cover" />}
					</Match>
				</Switch>
			</div>

			<div class="min-w-0 flex-1">
				<div class="truncate text-xs text-foreground" title={props.row.label}>
					{props.row.label || `Generated ${props.row.kind}`}
				</div>
				<div class="mt-0.5 text-xxs text-muted-foreground">
					<Switch>
						<Match when={generating()}>
							<span>Generating… · {formatCredits(props.row.credits)}</span>
						</Match>
						<Match when={props.row.status === 'succeeded'}>
							<span>{formatCredits(props.row.credits)}</span>
						</Match>
						<Match when={props.row.status === 'failed'}>
							<span class="text-destructive-accent-foreground">
								{props.row.error ?? 'Generation failed.'}
								<Show when={props.row.refunded}> No credits were charged.</Show>
							</span>
						</Match>
					</Switch>
				</div>
			</div>

			<Show when={props.row.status === 'succeeded' && props.row.output?.url}>
				<Tooltip>
					<TooltipTrigger
						as={Button}
						size="icon"
						variant="ghost"
						class="shrink-0 text-muted-foreground"
						aria-label="Add to canvas"
						onClick={addToCanvas}
					>
						<Icon name="plus-add" class="size-6" />
					</TooltipTrigger>
					<TooltipContent>Add to canvas</TooltipContent>
				</Tooltip>
			</Show>
		</div>
	);
}
