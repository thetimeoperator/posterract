import { Button, Panel, Segmented } from "@posterract/hyperkit";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { TikTokCreatorInfo, TikTokPostOptions, TikTokPrivacy } from "@posterract/contract/tiktok";

const privacyLabels: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me",
};
export const TIKTOK_DISCLOSURE_HINT = "You need to indicate if your content promotes yourself, a third party, or both.";
const PRIVATE_BRANDED_HINT = "Branded content visibility cannot be set to private.";
const hintClass = "absolute bottom-full left-0 z-50 mb-1 w-full min-w-48 rounded-lg border border-white/15 bg-void-2 px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-starlight shadow-xl";

/** A disabled button cannot receive focus, so its explanation has a focusable wrapper. */
export function TikTokHoverHint({ message, children, label, className = "w-full" }: { message?: string; children: ReactNode; label: string; className?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className={`relative ${className}`} tabIndex={message ? 0 : undefined} aria-label={message ? label : undefined}
    aria-describedby={message ? id : undefined} onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}
    onFocus={() => setVisible(true)} onBlur={() => setVisible(false)} onKeyDown={(event) => { if (event.key === "Escape") setVisible(false); }}>
    {children}
    {message && <span id={id} role="tooltip" hidden={!visible} className={hintClass}>{message}</span>}
  </div>;
}

/** Native select popups do not reliably expose hover events on disabled options. */
export function TikTokPrivacySelect({ value, options, disabled, branded, onChange }: {
  value: TikTokPrivacy | ""; options: TikTokPrivacy[]; disabled: boolean; branded: boolean; onChange: (value: TikTokPrivacy) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const expanded = open && !disabled;
  const restricted = (privacy: TikTokPrivacy) => privacy === "SELF_ONLY" && branded;
  const optionId = (index: number) => `${id}-option-${index}`;
  const hintId = `${id}-hint`;
  const activeRestricted = !!options[active] && restricted(options[active]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);
  useEffect(() => { setOpen(false); setShowHint(false); }, [disabled, options]);
  const openList = () => { setActive(Math.max(0, options.indexOf(value as TikTokPrivacy))); setShowHint(false); setOpen(true); };
  const choose = (index: number) => {
    const privacy = options[index];
    if (!privacy || restricted(privacy)) { setShowHint(true); return; }
    onChange(privacy); setOpen(false); setShowHint(false);
  };
  return <div ref={root} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`} className="block text-[12px] text-starlight-dim">Who can view this post?</span>
    <button type="button" role="combobox" aria-label="TikTok privacy" aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded ? optionId(active) : undefined}
      aria-describedby={expanded && activeRestricted ? hintId : undefined} disabled={disabled}
      onClick={() => expanded ? setOpen(false) : openList()}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) { openList(); return; }
          setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          setShowHint(true);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (expanded) choose(active); else openList();
        } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); setShowHint(false); }
        else if (event.key === "Tab") setOpen(false);
      }}
      className="mt-1.5 flex h-10 w-full items-center justify-between rounded-[10px] border border-white/[0.09] bg-void-2 px-3 text-left text-[12px] text-starlight outline-none focus:border-neon/30 disabled:opacity-50">
      <span>{value ? privacyLabels[value] : "Choose privacy…"}</span><ChevronDown size={13} aria-hidden />
    </button>
    {expanded && <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}
      className="absolute left-0 top-full z-40 mt-1 w-full rounded-[10px] border border-white/15 bg-void-2 p-1 shadow-xl">
      {options.map((privacy, index) => <div key={privacy} id={optionId(index)} role="option" aria-label={privacyLabels[privacy]}
        aria-selected={value === privacy} aria-disabled={restricted(privacy)} aria-describedby={restricted(privacy) ? hintId : undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}
        onMouseEnter={() => { setActive(index); setShowHint(true); }} onMouseLeave={() => setShowHint(false)}
        className={`rounded-md px-2 py-2 text-[12px] ${active === index ? "bg-white/[0.08]" : ""} ${restricted(privacy) ? "cursor-not-allowed text-starlight-faint" : "cursor-pointer text-starlight"}`}>
        {privacyLabels[privacy]}
        {restricted(privacy) && <span id={hintId} role="tooltip" hidden={!showHint || active !== index} className={hintClass}>{PRIVATE_BRANDED_HINT}</span>}
      </div>)}
    </div>}
  </div>;
}

export function TikTokDeclaration({ branded }: { branded: boolean }) {
  return <p className="text-[11px] leading-relaxed text-starlight-dim">By posting, you agree to TikTok’s {branded && <>
    <a className="text-neon underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a> and </>}
    <a className="text-neon underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.
  </p>;
}

export function TikTokSettings({ value, onChange, creator, loading, error, validation, onRefresh }: {
  value: TikTokPostOptions; onChange: (value: TikTokPostOptions) => void; creator?: TikTokCreatorInfo;
  loading: boolean; error?: string; validation?: string; onRefresh: () => void;
}) {
  const checkbox = (key: "allowComment" | "allowDuet" | "allowStitch" | "brandOrganic" | "brandContent" | "isAigc", label: string, disabled = false) =>
    <label key={key} className={`flex items-start gap-2 text-[12px] ${disabled ? "cursor-not-allowed text-starlight-faint opacity-50" : "text-starlight-dim"}`}>
      <input type="checkbox" className="mt-0.5 accent-[#65ff9a]" checked={value[key]} disabled={disabled} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} />{label}
    </label>;
  return <Panel title="TikTok Settings" kicker="Posting preferences" brackets>
    <div className="space-y-3">
      <Segmented aria-label="TikTok posting mode" value={value.mode} onChange={(mode) => onChange({ ...value, mode })}
        options={[{ value: "direct", label: "Post directly" }, { value: "inbox", label: "Send to TikTok inbox" }]} />
      {value.mode === "inbox" ? <p className="text-[12px] text-starlight-dim">We’ll send this video to your TikTok inbox. Open the notification in TikTok to edit it, choose settings, and finish posting. Inbox delivery is not a published post.</p> : <>
        {loading && <p role="status" className="text-[12px] text-starlight-dim">Loading current TikTok account settings…</p>}
        {error && <p role="alert" className="text-[12px] text-solar">{error}</p>}
        {!loading && <Button size="sm" variant="tertiary" onClick={onRefresh}>Refresh TikTok settings</Button>}
        {creator && <p className="text-[12px] text-starlight-dim">Posting as <strong className="text-starlight">{creator.creator_nickname}</strong>{creator.creator_username && ` (@${creator.creator_username})`} · up to {creator.max_video_post_duration_sec}s</p>}
        <TikTokPrivacySelect value={value.privacyLevel} options={creator?.privacy_level_options ?? []} disabled={!creator?.privacy_level_options.length || loading}
          branded={value.brandContent} onChange={(privacyLevel) => onChange({ ...value, privacyLevel })} />
        <div className="flex flex-wrap gap-3">
          {checkbox("allowComment", "Allow comments", !creator || loading || creator.comment_disabled)}
          {checkbox("allowDuet", "Allow Duet", !creator || loading || creator.duet_disabled)}
          {checkbox("allowStitch", "Allow Stitch", !creator || loading || creator.stitch_disabled)}
        </div>
        <p className="text-[10px] text-starlight-faint">Greyed-out interactions are unavailable in this account’s TikTok settings.</p>
        <div className="space-y-2 border-t border-white/[0.08] pt-3">
          <label className="flex gap-2 text-[12px] text-starlight-dim"><input type="checkbox" className="accent-[#65ff9a]" checked={value.commercialContent}
            onChange={(e) => onChange({ ...value, commercialContent: e.target.checked, brandOrganic: false, brandContent: false })} />Disclose commercial content</label>
          <p className="text-[10px] text-starlight-faint">Turn on if this video promotes you, a brand, product, or service.</p>
          {value.commercialContent && <div className="space-y-2 pl-5">
            {checkbox("brandOrganic", "Your brand — promoting yourself or your business")}
            <TikTokHoverHint message={value.privacyLevel === "SELF_ONLY" ? PRIVATE_BRANDED_HINT : undefined} label="Why branded content is unavailable">
              {checkbox("brandContent", "Branded content — promoting another brand or third party", value.privacyLevel === "SELF_ONLY")}
            </TikTokHoverHint>
            {(value.privacyLevel === "SELF_ONLY" || value.brandContent) && <p className="text-[11px] text-solar">{PRIVATE_BRANDED_HINT}</p>}
            {(value.brandOrganic || value.brandContent) && <p className="text-[11px] text-starlight-dim">Your video will be labeled as “{value.brandContent ? "Paid partnership" : "Promotional content"}”.</p>}
          </div>}
        </div>
        {checkbox("isAigc", "AI-generated content")}
        <p className="text-[10px] text-starlight-faint">TikTok will label this video as AI-generated when enabled.</p>
        {validation && creator && <p role="alert" className="text-[11px] text-solar">{validation}</p>}
      </>}
    </div>
  </Panel>;
}
