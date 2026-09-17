import { RefreshCw, Send, Smartphone } from "lucide-react";
import { useId } from "react";
import type { TikTokCreatorInfo, TikTokPostOptions } from "@posterract/contract/tiktok";
import { TikTokDeclaration, TikTokHoverHint, TikTokPrivacySelect } from "@/components/TikTokSettings";

function SettingToggle({ label, description, checked, disabled, onChange }: {
  label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return <label className="web-compose-toggle-row" data-disabled={disabled || undefined}>
    <span><strong>{label}</strong>{description && <small id={id}>{description}</small>}</span>
    <input type="checkbox" aria-label={label} aria-describedby={description ? id : undefined} checked={checked} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />
    <span className="web-compose-toggle" aria-hidden />
  </label>;
}

export function WebTikTokSettings({ value, onChange, creator, loading, error, onRefresh }: {
  value: TikTokPostOptions; onChange: (value: TikTokPostOptions) => void; creator?: TikTokCreatorInfo;
  loading: boolean; error?: string; onRefresh: () => void;
}) {
  const change = (key: "allowComment" | "allowDuet" | "allowStitch" | "brandOrganic" | "brandContent" | "isAigc", checked: boolean) => onChange({ ...value, [key]: checked });
  return <div className="web-compose-tiktok">
    <div className="web-compose-settings-heading"><h4>Publishing options</h4>
      <button type="button" aria-label="Refresh TikTok settings" onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : undefined} /> Refresh</button></div>
    <div className="web-compose-delivery" role="radiogroup" aria-label="TikTok posting mode">
      <button type="button" role="radio" aria-label="Post directly" aria-checked={value.mode === "direct"} onClick={() => onChange({ ...value, mode: "direct" })}>
        <Send size={17} /><span><strong>Post directly</strong><small>Publish from Posterract</small></span></button>
      <button type="button" role="radio" aria-label="Send to TikTok inbox" aria-checked={value.mode === "inbox"} onClick={() => onChange({ ...value, mode: "inbox" })}>
        <Smartphone size={18} /><span><strong>Send to TikTok inbox</strong><small>Finish in the TikTok app</small></span></button>
    </div>
    {value.mode === "inbox" ? <p className="web-compose-setting-note">We’ll send this video to your TikTok inbox. Open the notification in TikTok to edit it, choose settings, and finish posting. Inbox delivery is not a published post.</p> : <>
      {loading && <p role="status" className="web-compose-setting-note">Loading current TikTok account settings…</p>}
      {error && <p role="alert" className="web-compose-inline-error">{error}</p>}
      <TikTokPrivacySelect value={value.privacyLevel} options={creator?.privacy_level_options ?? []} disabled={!creator?.privacy_level_options.length || loading}
        branded={value.brandContent} onChange={(privacyLevel) => onChange({ ...value, privacyLevel })} />
      <div className="web-compose-settings-columns">
        <div className="web-compose-setting-group"><h4>Interactions</h4>
          <SettingToggle label="Allow comments" checked={value.allowComment} disabled={!creator || loading || creator.comment_disabled} onChange={(v) => change("allowComment", v)} />
          <SettingToggle label="Allow Duet" checked={value.allowDuet} disabled={!creator || loading || creator.duet_disabled} onChange={(v) => change("allowDuet", v)} />
          <SettingToggle label="Allow Stitch" checked={value.allowStitch} disabled={!creator || loading || creator.stitch_disabled} onChange={(v) => change("allowStitch", v)} />
          <p className="web-compose-setting-note">Unavailable interactions are controlled by this TikTok account.</p>
        </div>
        <div className="web-compose-setting-group"><h4>Content disclosures</h4>
          <SettingToggle label="Disclose commercial content" description="This promotes you, a brand, product, or service." checked={value.commercialContent}
            onChange={(commercialContent) => onChange({ ...value, commercialContent, brandOrganic: false, brandContent: false })} />
          {value.commercialContent && <div className="web-compose-disclosure-options">
            <SettingToggle label="Your brand — promoting yourself or your business" checked={value.brandOrganic} onChange={(v) => change("brandOrganic", v)} />
            <TikTokHoverHint message={value.privacyLevel === "SELF_ONLY" ? "Branded content visibility cannot be set to private." : undefined} label="Why branded content is unavailable">
              <SettingToggle label="Branded content — promoting another brand or third party" checked={value.brandContent} disabled={value.privacyLevel === "SELF_ONLY"} onChange={(v) => change("brandContent", v)} />
            </TikTokHoverHint>
            {(value.privacyLevel === "SELF_ONLY" || value.brandContent) && <p className="web-compose-setting-note">Branded content visibility cannot be set to private.</p>}
            {(value.brandOrganic || value.brandContent) && <p className="web-compose-setting-note">Your video will be labeled as “{value.brandContent ? "Paid partnership" : "Promotional content"}”.</p>}
          </div>}
          <SettingToggle label="AI-generated content" description="TikTok will label this video as AI-generated." checked={value.isAigc} onChange={(v) => change("isAigc", v)} />
        </div>
      </div>
      <div className="web-compose-tiktok-declaration"><TikTokDeclaration branded={value.brandContent} /></div>
    </>}
  </div>;
}
