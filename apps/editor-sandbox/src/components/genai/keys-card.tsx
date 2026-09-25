/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, Show } from 'solid-js';
import { toast } from 'somoto';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextField, TextFieldInput } from '@/components/ui/text-field';
import { useAi } from '@/context/ai';
import { openExternal, PROVIDER_LABELS } from '@/lib/ai-bridge';

/**
 * Asks for the one provider key something needs, where it is needed: the
 * Generate panel for its providers, the voice bar for speech and for Jev.
 * The key is saved once, for every project on this computer, and never
 * leaves it: a project made tomorrow already has it. A project that keeps an
 * api-keys.json of its own still uses that.
 */
export function KeysCard(props: { provider: keyof typeof PROVIDER_LABELS }) {
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
				, paste it below. Saved for every project on this computer, and it never leaves it.
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
