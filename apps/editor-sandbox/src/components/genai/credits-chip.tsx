/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The AI credit balance, worn in the editor's top chrome next to the other
 * status readouts. It only exists while the app shell is on the other side of
 * the bridge — standalone there is no balance to show, so there is no chip.
 * The provider refreshes the number when the Generate panel opens and when a
 * generation settles; this is just the face of it.
 */

import { createMemo, Show } from 'solid-js';

import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAi } from '@/context/ai';

export function CreditsChip() {
	const ai = useAi();

	const visible = createMemo(() => (ai.availability() === 'connected' ? ai.credits() : undefined));

	const resetsIn = createMemo(() => {
		const iso = ai.credits()?.cycleResetsAt;
		if (!iso) return null;
		const at = new Date(iso).getTime();
		if (Number.isNaN(at)) return null;
		const days = Math.ceil((at - Date.now()) / 86_400_000);
		if (days <= 0) return 'resets today';
		return `resets in ${days} ${days === 1 ? 'day' : 'days'}`;
	});

	return (
		<Show when={visible()}>
			{(credits) => (
				<Tooltip>
					<TooltipTrigger
						class="inline-flex h-5 items-center gap-1 rounded bg-input px-1.5 text-xxs text-muted-foreground outline-none focus-ring"
						aria-label="AI credit balance"
					>
						<Icon name="ai-generate" class="size-3.5 shrink-0 text-primary" />
						<span>{credits().balance.toLocaleString()} cr</span>
					</TooltipTrigger>
					<TooltipContent>
						AI credits{resetsIn() ? ` · ${resetsIn()}` : ''}
					</TooltipContent>
				</Tooltip>
			)}
		</Show>
	);
}
