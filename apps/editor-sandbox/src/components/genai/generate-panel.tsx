/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Generate panel: prompt-to-media with the user's OWN provider keys,
 * opened from the sidebar's brand slot. Three tabs (image, video, voice)
 * share one footer. There are no credits and no middleman: keys live in the
 * project's api-keys.json, generation runs through the desktop main process,
 * and results land in the project's assets/generated — then on the canvas
 * through the same insert path an imported asset takes.
 */

import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from 'solid-js';
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
import { TextField, TextFieldInput, TextFieldTextArea } from '@/components/ui/text-field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAi } from '@/context/ai';
import {
	IMAGE_RESOLUTIONS,
	KEY_FOR_KIND,
	openExternal,
	PROVIDER_LABELS,
	VIDEO_ASPECTS,
	VIDEO_DURATION,
	VIDEO_QUALITIES,
	videoQualityLabel,
} from '@/lib/ai-bridge';
import { ReferenceImageError, toReferenceImage } from '@/lib/reference-image';
import { useEditor } from '@/engine/hooks';
import { insertGeneration } from './insert-generation';

import type { AiGenerationRow } from '@/context/ai';
import type {
	AiGenerationKind,
	AiGenerationRequest,
	ImageResolution,
	VideoAspect,
	VideoQuality,
} from '@/lib/ai-bridge';
import type { Entity } from 'koota';

/**
 * Voice choices. The default sends no id and lets Fish speak with its stock
 * voice; the named ids are placeholders users can swap for their own.
 */
const FISH_VOICES: ReadonlyArray<{ id: string; label: string }> = [
	{ id: '', label: 'Studio default' },
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

// The drafts live at module scope: the popover unmounts its content when it
// closes, and an accidental outside click must not eat a prompt someone was
// still writing.
const [tab, setTab] = createSignal<AiGenerationKind>('image');

const [imagePrompt, setImagePrompt] = createSignal('');
const [imageAspect, setImageAspect] = createSignal<VideoAspect>('1:1');
const [imageResolution, setImageResolution] = createSignal<ImageResolution>('1K');

const [videoPrompt, setVideoPrompt] = createSignal('');
const [videoAspect, setVideoAspect] = createSignal<VideoAspect>('9:16');
const [videoDuration, setVideoDuration] = createSignal(6);
const [videoQuality, setVideoQuality] = createSignal<VideoQuality>('768P');
/** The image-to-video reference: a downscaled frame plus what to call it. */
const [videoReference, setVideoReference] = createSignal<{ dataUrl: string; label: string } | null>(null);

const [voiceText, setVoiceText] = createSignal('');
const [voiceId, setVoiceId] = createSignal(FISH_VOICES[0]!.id);

/** The element a generation is FOR: the finished asset replaces its `src`. */
const [generationTarget, setGenerationTarget] = createSignal<{ entity: Entity; label: string } | null>(null);

/** Bumped by `openGeneratePanel`; the launcher opens on every bump. */
const [openTick, setOpenTick] = createSignal(0);

export interface GeneratePrefill {
	tab?: AiGenerationKind;
	videoReference?: { dataUrl: string; label: string } | null;
	videoPrompt?: string;
	imagePrompt?: string;
	aspect?: VideoAspect;
	target?: { entity: Entity; label: string } | null;
}

/** Opens the Generate panel, optionally prefilled and targeted. */
export function openGeneratePanel(prefill: GeneratePrefill = {}): void {
	if (prefill.tab) setTab(prefill.tab);
	if (prefill.videoReference !== undefined) setVideoReference(prefill.videoReference);
	if (prefill.videoPrompt !== undefined) setVideoPrompt(prefill.videoPrompt);
	if (prefill.imagePrompt !== undefined) setImagePrompt(prefill.imagePrompt);
	if (prefill.aspect) {
		setImageAspect(prefill.aspect);
		setVideoAspect(prefill.aspect);
	}
	setGenerationTarget(prefill.target ?? null);
	setOpenTick((tick) => tick + 1);
}

/**
 * Prepares `source` (a Blob or a URL/data URL) as a reference frame and
 * opens the panel on the Video tab with it attached.
 */
export async function animateImage(
	source: Blob | string,
	label: string,
	target?: { entity: Entity; label: string },
): Promise<void> {
	try {
		const dataUrl = await toReferenceImage(source);
		openGeneratePanel({ tab: 'video', videoReference: { dataUrl, label }, target: target ?? null });
	} catch (error) {
		toast.error('Could not prepare the image to animate', {
			description: error instanceof ReferenceImageError ? error.message : 'The image could not be read.',
		});
	}
}

/** The sidebar's Generate entry: the brand toggle plus the panel it opens. */
export function GenerateLauncher() {
	const ai = useAi();
	const [open, setOpen] = createSignal(false);

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		// Key status can change while the panel is closed (the user pasted a
		// key); every open re-reads it.
		if (next) void ai.refreshKeys();
	};

	createEffect(on(openTick, () => handleOpenChange(true), { defer: true }));

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
	const editor = useEditor();

	const request = createMemo<AiGenerationRequest>(() => {
		switch (tab()) {
			case 'image':
				return { kind: 'image', prompt: imagePrompt().trim(), aspectRatio: imageAspect(), resolution: imageResolution() };
			case 'video': {
				const reference = videoReference();
				return {
					kind: 'video',
					prompt: videoPrompt().trim(),
					aspectRatio: videoAspect(),
					durationSec: videoDuration(),
					quality: videoQuality(),
					...(reference ? { referenceImage: reference.dataUrl } : {}),
				};
			}
			case 'voice':
				return { kind: 'voice', text: voiceText(), voiceId: voiceId() };
		}
	});

	const empty = createMemo(() => {
		const current = request();
		return current.kind === 'voice' ? current.text.trim().length === 0 : current.prompt.length === 0;
	});

	/** The api-keys.json entry the current tab needs, and whether it is set. */
	const providerKey = () => KEY_FOR_KIND[tab()];
	const keyMissing = () => {
		const status = ai.keys();
		return status !== undefined && !status[providerKey()];
	};

	const canGenerate = () =>
		ai.availability() === 'ready' && !keyMissing() && !ai.busy() && !empty();

	const submit = async () => {
		if (!canGenerate()) return;
		const target = generationTarget();
		setGenerationTarget(null);
		const onOutput = target
			? (output: { path: string }) => {
					editor.editProperty(target.entity, 'src', output.path);
					toast.success(`Applied to ${target.label}`);
				}
			: undefined;
		await ai.generate(request(), onOutput);
	};

	return (
		<div class="flex max-h-[calc(100vh-96px)] flex-col text-foreground">
			<div class="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
				<span class="text-[12px] font-strong">Generate</span>
				<span class="ml-auto text-xxs text-muted-foreground">your keys · your account</span>
			</div>

			<Switch>
				<Match when={ai.availability() === 'no-desktop'}>
					<div class="flex items-start gap-2 border-t border-border px-4 py-4 text-xs leading-relaxed text-muted-foreground">
						<Icon name="alert-warning" class="size-4 shrink-0" />
						<span>AI generation runs in the Posterract desktop app.</span>
					</div>
				</Match>

				<Match when>
					<div class="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-1">
						<SegmentedIconTabs
							value={tab}
							onChange={(next) => setTab(next as AiGenerationKind)}
							items={TAB_ITEMS}
						/>

						<Show when={keyMissing()}>
							<KeysCard provider={providerKey()} />
						</Show>

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
									items={IMAGE_RESOLUTIONS.map((value) => ({ value, label: value }))}
								/>
							</div>
						</Show>

						<Show when={tab() === 'video'}>
							<Show
								when={videoReference()}
								fallback={
									<div class="text-xxs leading-relaxed text-muted-foreground">
										Tip: any image can become this video's first frame — press the
										film icon on an image result.
									</div>
								}
							>
								{(reference) => (
									<div class="flex h-10 items-center gap-2 rounded-md bg-input px-1.5">
										<img src={reference().dataUrl} alt="" class="size-7 shrink-0 rounded-sm object-cover" />
										<div class="min-w-0 flex-1">
											<div class="truncate text-xxs text-foreground">{reference().label}</div>
											<div class="text-[10px] text-muted-foreground">Animating this image</div>
										</div>
										<Button
											size="icon"
											variant="ghost"
											class="shrink-0 text-muted-foreground"
											aria-label="Remove the reference image"
											onClick={() => setVideoReference(null)}
										>
											<Icon name="close-remove-small" class="size-4" />
										</Button>
									</div>
								)}
							</Show>
							<PromptField
								value={videoPrompt()}
								onInput={setVideoPrompt}
								placeholder={videoReference() ? 'Describe how the image should move…' : 'Describe the video to generate…'}
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
								{videoDuration()}s · {videoQualityLabel(videoQuality())}
								<Show when={videoReference()}> · from image</Show>
							</div>
						</Show>

						<Show when={tab() === 'voice'}>
							<PromptField
								value={voiceText()}
								onInput={setVoiceText}
								placeholder="Write what the voice should say…"
							/>
							<VoiceSelect value={voiceId()} onChange={setVoiceId} />
						</Show>
					</div>

					<Show when={generationTarget()}>
						{(target) => (
							<div class="mx-4 mt-1 flex h-8 items-center gap-2 rounded-md bg-input px-2">
								<Icon name="ai-generate" class="size-4 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate text-xxs text-foreground">
									Result applies to <span class="font-strong">{target().label}</span>
								</span>
								<Button
									size="icon"
									variant="ghost"
									class="shrink-0 text-muted-foreground"
									aria-label="Don't apply to the element — just add to results"
									onClick={() => setGenerationTarget(null)}
								>
									<Icon name="close-remove-small" class="size-4" />
								</Button>
							</div>
						)}
					</Show>

					<div class="flex items-center gap-2 px-4 py-3">
						<Button class="ml-auto" disabled={!canGenerate()} onClick={() => void submit()}>
							<Show when={!ai.busy()} fallback={<>Generating…</>}>
								<Show when={generationTarget()} fallback={<>Generate</>}>
									Generate into element
								</Show>
							</Show>
						</Button>
					</div>
				</Match>
			</Switch>

			<ResultsList />
		</div>
	);
}

/**
 * The current tab's provider has no key yet: paste it right here. The key is
 * saved into the project's api-keys.json (gitignored, never leaves the
 * machine) and the panel unlocks the moment it lands.
 */
function KeysCard(props: { provider: keyof typeof PROVIDER_LABELS }) {
	const ai = useAi();
	const label = () => PROVIDER_LABELS[props.provider];
	const [value, setValue] = createSignal('');
	const [saving, setSaving] = createSignal(false);

	const save = async () => {
		const key = value().trim();
		if (!key || saving()) return;
		setSaving(true);
		try {
			await ai.saveKey(props.provider, key);
			setValue('');
			toast.success(`${label().name} key saved`);
		} catch (error) {
			toast.error('Could not save the key', {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class="flex flex-col gap-2 rounded-md bg-input px-3 py-2.5">
			<div class="flex items-center gap-2 text-xs text-foreground">
				<Icon name="lock-closed" class="size-4 shrink-0 text-muted-foreground" />
				<span>
					Add your <span class="font-strong">{label().name}</span> API key
				</span>
			</div>
			<div class="text-xxs leading-relaxed text-muted-foreground">
				Get one at{' '}
				<button
					type="button"
					class="underline hover:text-foreground"
					onClick={() => void openExternal(`https://${label().site}`)}
					title={`Open ${label().site}`}
				>
					{label().site}
				</button>
				, paste it below. Stored on this computer only.
			</div>
			<div class="flex items-center gap-1.5">
				<TextField value={value()} onChange={setValue} class="flex-1">
					<TextFieldInput
						type="password"
						placeholder="Paste your API key…"
						class="h-8 text-xs select-text"
						autocomplete="off"
						onKeyDown={(event: KeyboardEvent) => {
							if (event.key === 'Enter') void save();
						}}
					/>
				</TextField>
				<Button size="small" disabled={value().trim().length === 0 || saving()} onClick={() => void save()}>
					<Show when={!saving()} fallback={<>Saving…</>}>Save</Show>
				</Button>
			</div>
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
	const generating = () => props.row.status === 'running';

	const addToCanvas = () => {
		const output = props.row.output;
		if (!output?.path) return;
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
				<Show
					when={props.row.output?.previewDataUrl}
					fallback={
						<div class="flex size-full items-center justify-center text-muted-foreground">
							<Show when={generating()} fallback={<Icon name={KIND_ICONS[props.row.kind]} class="size-6" />}>
								<Icon name="spinner-loader" class="size-5 animate-spin" />
							</Show>
						</div>
					}
				>
					{(preview) => <img src={preview()} alt="" class="size-full object-cover" />}
				</Show>
			</div>

			<div class="min-w-0 flex-1">
				<div class="truncate text-xs text-foreground" title={props.row.label}>
					{props.row.label || `Generated ${props.row.kind}`}
				</div>
				<div class="mt-0.5 text-xxs text-muted-foreground">
					<Switch>
						<Match when={generating()}>
							<span>Generating…</span>
						</Match>
						<Match when={props.row.status === 'succeeded'}>
							<span>{props.row.output?.path}</span>
						</Match>
						<Match when={props.row.status === 'failed'}>
							<span class="text-destructive-accent-foreground">
								{props.row.error ?? 'Generation failed.'}
							</span>
						</Match>
					</Switch>
				</div>
			</div>

			<Show when={props.row.status === 'succeeded' && props.row.output?.path}>
				<Show when={props.row.kind === 'image' && props.row.output?.previewDataUrl}>
					<Tooltip>
						<TooltipTrigger
							as={Button}
							size="icon"
							variant="ghost"
							class="shrink-0 text-muted-foreground"
							aria-label="Animate this image into a video"
							onClick={() => void animateImage(props.row.output!.previewDataUrl!, props.row.label || 'Generated image')}
						>
							<Icon name="video" class="size-6" />
						</TooltipTrigger>
						<TooltipContent>Animate into a video</TooltipContent>
					</Tooltip>
				</Show>
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
