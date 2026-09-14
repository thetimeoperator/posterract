import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Film, RotateCcw } from 'lucide-react';
import { Button, Modal, StatusBadge, pushSignal } from '@posterract/hyperkit';
import { PLATFORM_CAPABILITIES } from '@posterract/contract';
import { artifactUrl, useEngineActions, usePortals, useProjections, useTransmissions } from '@/engine/useEngine';
import { localDateTimeValue } from '@/lib/calendar-date';

export function CalendarPostDialog({ transmissionId, onClose }: { transmissionId: string | null; onClose: () => void }) {
  const transmission = useTransmissions().find((item) => item.id === transmissionId);
  const projections = useProjections().filter((item) => item.transmissionId === transmissionId);
  const portals = usePortals();
  const actions = useEngineActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
  }, [transmissionId, transmission?.scheduledFor]);
  const media = artifactUrl(transmission?.artifactId);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const schedule = String(new FormData(event.currentTarget).get("scheduledTime") ?? "");
    if (!transmission || busy) return;
    const timestamp = new Date(schedule).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) { setError('Choose a date and time in the future.'); return; }
    // A nonexistent local time (the spring clock change) must not silently move an hour.
    if (localDateTimeValue(timestamp) !== schedule) { setError('That local time does not exist because the clocks change. Choose another time.'); return; }
    setBusy(true);
    setError('');
    try {
      await actions.rescheduleTransmission(transmission.id, timestamp);
      pushSignal({ tone: 'success', title: 'Post rescheduled', detail: new Date(timestamp).toLocaleString() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reschedule this post.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!transmission} onClose={onClose} title={transmission?.title || 'Post details'} kicker="Post details" width="max-w-3xl" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      {transmission && <div className="max-h-[65vh] overflow-y-auto pr-1">
        <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div className="flex aspect-[9/12] items-center justify-center overflow-hidden rounded-xl border border-[var(--glass-border)] bg-black/30">
            {media ? <video key={media} src={media} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label="Post video preview" /> : <div className="flex flex-col items-center gap-2 text-xs text-starlight-faint"><Film size={28} /> No video attached</div>}
          </div>
          <div className="min-w-0 space-y-4">
            <StatusBadge status={transmission.status} />
            {transmission.scheduledFor && <div><p className="text-xs text-starlight-faint">Scheduled time · {timezone}</p><p className="mt-1 text-sm text-starlight">{new Date(transmission.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p></div>}
            <div><p className="mb-1 text-xs text-starlight-faint">Caption</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-starlight">{transmission.baseCaption || 'No caption'}</p>{transmission.hashtags.length > 0 && <p className="mt-2 break-words text-xs text-neon">{transmission.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}</p>}</div>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <h3 className="text-xs font-medium text-starlight-dim">Accounts & publishing status</h3>
          {projections.length === 0 && <p className="text-xs text-starlight-faint">No destinations attached.</p>}
          {projections.map((projection) => {
            const portal = portals.find((item) => item.id === projection.portalId);
            const publicUrl = /^https?:\/\//i.test(projection.platformPostUrl ?? '') ? projection.platformPostUrl : undefined;
            return <div key={projection.id} className="rounded-xl border border-[var(--glass-border)] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2"><div className="mr-auto"><p className="text-xs font-medium text-starlight">{PLATFORM_CAPABILITIES[projection.provider].label}</p><p className="mt-0.5 text-xs text-starlight-faint">{portal?.displayName || portal?.handle || 'Connected account'}{portal?.displayName && portal.handle ? ` · ${portal.handle}` : ''}</p></div><StatusBadge status={projection.status} size="sm" />{publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-neon">View post <ExternalLink size={12} /></a>}{(projection.status === 'failed' || projection.status === 'needs_reauth') && <Button size="sm" variant="secondary" onClick={() => actions.retryProjection(projection.id)} icon={<RotateCcw size={12} />}>Retry</Button>}</div>
              {projection.errorSummary && <p className="mt-2 text-xs text-red-300">{projection.errorSummary}</p>}
              {(projection.caption !== transmission.baseCaption || projection.hashtags.join(' ') !== transmission.hashtags.join(' ')) && <details className="mt-2 text-xs text-starlight-dim"><summary className="cursor-pointer">Platform caption</summary><p className="mt-2 whitespace-pre-wrap">{projection.caption}</p><p>{projection.hashtags.join(' ')}</p></details>}
            </div>;
          })}
        </div>
        {transmission.status === 'scheduled' && <div className="mt-5 border-t border-[var(--glass-border)] pt-4">
          <label className="block text-xs text-starlight-dim" htmlFor="calendar-post-time">Reschedule · {timezone}</label>
          <form onSubmit={(event) => void reschedule(event)} className="mt-2 flex flex-wrap items-center gap-2"><input id="calendar-post-time" name="scheduledTime" type="datetime-local" required key={`${transmission.id}-${transmission.scheduledFor}`} defaultValue={transmission.scheduledFor ? localDateTimeValue(transmission.scheduledFor) : ""} className="rounded-lg border border-[var(--glass-border)] bg-void-2 px-3 py-2 text-sm text-starlight [color-scheme:dark]" /><Button type="submit" size="sm" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Reschedule'}</Button><Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => actions.cancelTransmission(transmission.id)}>Cancel post</Button></form>
          {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        </div>}
      </div>}
    </Modal>
  );
}
