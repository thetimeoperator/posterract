import { Link, createFileRoute } from "@tanstack/react-router";
import { MiniTesseract } from "@posterract/hyperkit";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="July 13, 2026">
      <p className="legal-lede">
        This Privacy Policy explains how Posterract collects, uses, stores, shares, and deletes
        information when you use posterract.app, connect a social-media account, publish content,
        or view analytics. It also explains the additional rules that apply to data received from
        each connected social platform.
      </p>

      <div className="legal-summary">
        <strong>Plain-language summary.</strong> You control what Posterract publishes. We use
        connected-platform data only to provide the publishing, scheduling, account connection,
        and analytics features you request. We do not sell personal information, store your social
        media passwords, or use your content or platform data to train AI models.
      </div>

      <nav className="legal-toc" aria-label="Privacy policy contents">
        <a href="#information">Information collected</a>
        <a href="#uses">How information is used</a>
        <a href="#sharing">Sharing and processors</a>
        <a href="#platforms">Platform-specific disclosures</a>
        <a href="#youtube-google">YouTube and Google</a>
        <a href="#deletion">Retention and deletion</a>
        <a href="#contact">Contact</a>
      </nav>

      <h2>1. What Posterract does</h2>
      <p>
        Posterract (accessible at posterract.app) is a social media scheduling service. You upload
        short-form videos, write captions, connect your social media accounts, and Posterract
        publishes your content to those platforms at the times you choose — either through the web
        app or through our API.
      </p>

      <h2 id="information">2. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your name, email address, and a hashed password when
          you create an account, plus essential authentication-session information used to keep you
          signed in.
        </li>
        <li>
          <strong>Content you upload.</strong> Video files, captions, hashtags, and scheduling
          preferences you create in the product, as well as platform-specific publishing choices
          such as visibility, audience, and disclosure settings.
        </li>
        <li>
          <strong>Connected platform credentials.</strong> When you connect a social media account
          through an available integration, we receive OAuth access or refresh tokens, the scopes
          you granted, token-expiration information, and platform account identifiers. Tokens are
          stored server-side so we can perform actions you request. We never receive or store your
          social media passwords.
        </li>
        <li>
          <strong>Platform profile and publishing information.</strong> Depending on the platform
          and permissions you approve, this may include your account ID, username or display name,
          connected channel or page, post IDs, post URLs, upload status, and publishing errors.
        </li>
        <li>
          <strong>Platform analytics.</strong> Where the integration supports analytics, we may
          retrieve audience totals and performance data for your connected account and posts, such
          as views, likes, comments, shares, watch time, and follower or subscriber changes.
        </li>
        <li>
          <strong>Service and security information.</strong> We and our infrastructure providers may
          process ordinary technical records needed to deliver and secure the service, such as
          request timing, error details, browser or device information, and IP address.
        </li>
      </ul>

      <h2 id="uses">3. How we use information</h2>
      <ul>
        <li>Authenticate you and maintain your Posterract workspace.</li>
        <li>Store, schedule, and publish the content you explicitly select.</li>
        <li>Connect and maintain authorized social-platform integrations.</li>
        <li>Show publishing status, account totals, and post-performance analytics.</li>
        <li>Calculate Posterract features such as performance points from displayed metrics.</li>
        <li>Operate, troubleshoot, secure, and improve Posterract.</li>
        <li>Comply with law and enforce our Terms of Service.</li>
      </ul>

      <h2>4. What we do not do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>We do not post to your accounts except as you schedule or instruct.</li>
        <li>We do not request access to or read your private messages.</li>
        <li>We do not use your content or connected-platform data to train AI models.</li>
        <li>We do not use connected-platform data for targeted advertising.</li>
      </ul>

      <h2 id="sharing">5. When information is shared</h2>
      <p>We share information only as needed for the following purposes:</p>
      <ul>
        <li>
          <strong>Platforms you select.</strong> We transmit your video, caption, publishing choices,
          and necessary account authorization to the destination platform when you direct us to
          publish or retrieve analytics.
        </li>
        <li>
          <strong>Infrastructure providers.</strong> Convex provides database, file-storage, backend,
          and scheduling infrastructure. Vercel provides web hosting and delivery. These providers
          process information to operate Posterract on our behalf.
        </li>
        <li>
          <strong>Legal and safety requirements.</strong> We may disclose information when reasonably
          necessary to comply with law, protect users, investigate abuse, or defend legal rights.
        </li>
      </ul>
      <p>We do not permit third parties to use connected-platform data for their own advertising.</p>

      <h2>6. Storage and security</h2>
      <p>
        Data is stored with our infrastructure providers: Convex (database, file storage, and
        scheduling) and Vercel (web hosting). Data is encrypted in transit. Platform access tokens
        are restricted to server-side functions and are not returned to other users. We use
        reasonable technical and organizational safeguards, but no online service can guarantee
        absolute security.
      </p>

      <h2>7. Essential cookies</h2>
      <p>
        Posterract uses essential cookies or equivalent browser storage to authenticate users,
        preserve sessions, and protect the service. We do not currently use third-party advertising
        cookies.
      </p>

      <h2 id="platforms">8. Platform-specific disclosures</h2>
      <p>
        The following disclosures explain the information Posterract accesses through each social
        platform. “Active integration” means the connector currently exists in Posterract.
        “Planned integration” means Posterract does not currently request or store data from that
        platform; the disclosure describes the limited data we expect to use if the integration is
        activated after platform approval.
      </p>

      <section className="platform-policy platform-policy-featured" id="youtube-google">
        <div className="platform-policy-heading">
          <h3>YouTube</h3>
          <span>Active integration</span>
        </div>
        <p>
          Posterract uses YouTube API Services. With your consent, Posterract requests the
          <code>youtube.upload</code>, <code>youtube.readonly</code>, and
          <code>yt-analytics.readonly</code> scopes. Google provides OAuth authorization tokens and
          information associated with the YouTube channel you select.
        </p>
        <p>
          <strong>Data accessed and stored:</strong> channel ID, channel name, granted scopes,
          authorization tokens, subscriber and channel totals, uploaded-video IDs and URLs,
          publishing status, and authorized channel or video analytics such as views, likes,
          comments, shares, watch time, and subscriber gains or losses.
        </p>
        <p>
          <strong>How it is used:</strong> to connect your channel; upload or schedule videos only
          when you instruct us; apply the title, description, privacy, audience, synthetic-media,
          and notification choices you select; show delivery status and analytics; and calculate
          clearly labeled Posterract performance features. We do not access YouTube private
          messages, sell YouTube API Data, use it for advertising, or use it to train AI models.
        </p>

        <div className="google-disclosure">
          <p className="google-disclosure-kicker">Google privacy, permissions, and deletion</p>
          <p>
            Posterract&apos;s use and transfer of information received from Google APIs adheres to the
            Google API Services User Data Policy, including its Limited Use requirements. Review
            the{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
              Google Privacy Policy
            </a>
            , the{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
              YouTube Terms of Service
            </a>
            , and the{" "}
            <a
              href="https://developers.google.com/youtube/terms/api-services-terms-of-service"
              target="_blank"
              rel="noreferrer"
            >
              YouTube API Services Terms of Service
            </a>
            .
          </p>
          <p>
            You may disconnect YouTube from Posterract&apos;s Accounts page or revoke Posterract from
            your{" "}
            <a
              href="https://security.google.com/settings/security/permissions"
              target="_blank"
              rel="noreferrer"
            >
              Google Account permissions
            </a>
            . Disconnecting YouTube causes Posterract to request revocation from Google and delete
            the stored Google OAuth tokens from its active connection records. After revocation,
            loss of authorization, or a verified deletion request, we delete remaining Google user
            data associated with the connection within 30 days, except where retention is required
            by law. Authorized YouTube statistics retained for historical analytics are refreshed
            or authorization is reverified at least every 30 days while the connection remains
            active.
          </p>
        </div>
      </section>

      <section className="platform-policy" id="tiktok">
        <div className="platform-policy-heading">
          <h3>TikTok</h3>
          <span>Active integration</span>
        </div>
        <p>
          With your consent, Posterract may receive TikTok OAuth tokens, Open ID, display name,
          granted scopes, account totals (including followers, following, likes, and video count),
          your Posterract-published TikTok video IDs and status, and video metrics such as views,
          likes, comments, and shares. We use this information only to connect your account,
          publish videos you direct us to publish, show delivery status, and display analytics.
          Disconnecting deletes the stored TikTok tokens from Posterract; you may also remove access
          in TikTok settings. Remaining TikTok-derived account data is deleted following a verified
          deletion request, subject to applicable platform rules and law. See the{" "}
          <a href="https://www.tiktok.com/legal/page/us/privacy-policy/en" target="_blank" rel="noreferrer">
            TikTok Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="platform-policy" id="instagram">
        <div className="platform-policy-heading">
          <h3>Instagram</h3>
          <span>Active integration</span>
        </div>
        <p>
          With your consent, Posterract may receive an Instagram professional-account ID,
          username, OAuth token, granted permissions, token-expiration information, and identifiers,
          permalinks, and delivery status for Reels published through Posterract. We use this data
          only to maintain the connection and publish content you explicitly select. Disconnecting
          deletes the stored Instagram token from Posterract; you may also remove Posterract from
          Instagram or Meta&apos;s connected-app settings. See the{" "}
          <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">
            Meta Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="platform-policy" id="facebook">
        <div className="platform-policy-heading">
          <h3>Facebook</h3>
          <span>Planned integration</span>
        </div>
        <p>
          Posterract does not currently request or store Facebook API data. If this integration is
          activated after Meta approval, Posterract will request only the permissions required to
          identify a user-authorized Page, publish selected content, report delivery status, and
          display authorized performance metrics. Disconnecting will remove stored credentials,
          and users may request deletion of associated Facebook-derived data. See the{" "}
          <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">
            Meta Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="platform-policy" id="threads">
        <div className="platform-policy-heading">
          <h3>Threads</h3>
          <span>Planned integration</span>
        </div>
        <p>
          Posterract does not currently request or store Threads API data. If this integration is
          activated after Meta approval, Posterract will request only the permissions needed to
          identify the authorized profile, publish user-selected content, return publishing status,
          and display available authorized metrics. Disconnecting will remove stored credentials,
          and users may request deletion of associated Threads-derived data. Threads is a Meta
          product; see the{" "}
          <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">
            Meta Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="platform-policy" id="x">
        <div className="platform-policy-heading">
          <h3>X</h3>
          <span>Planned integration</span>
        </div>
        <p>
          Posterract does not currently request or store X API data. If this integration is
          activated after X approval, Posterract will request only the permissions needed to
          identify the authorized account, publish content the user has reviewed and approved,
          return publishing status, and display available authorized metrics. We will not access
          direct messages. Disconnecting will remove stored credentials, and X-derived content will
          be corrected or deleted as required by X&apos;s policies. See the{" "}
          <a href="https://x.com/en/privacy" target="_blank" rel="noreferrer">
            X Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="platform-policy" id="linkedin">
        <div className="platform-policy-heading">
          <h3>LinkedIn</h3>
          <span>Planned integration</span>
        </div>
        <p>
          Posterract does not currently request or store LinkedIn API data. If this integration is
          activated after LinkedIn approval, Posterract will request only the permissions required
          to identify an authorized member or organization, publish user-selected content, report
          delivery status, and display permitted analytics. Disconnecting will remove stored
          credentials, and LinkedIn-derived data will be deleted or refreshed according to
          LinkedIn&apos;s applicable retention rules and verified user requests. See the{" "}
          <a href="https://www.linkedin.com/legal/privacy-policy" target="_blank" rel="noreferrer">
            LinkedIn Privacy Policy
          </a>
          .
        </p>
      </section>

      <h2 id="deletion">9. Data retention, disconnection, and deletion</h2>
      <ul>
        <li>
          <strong>Posterract account and workspace data.</strong> Retained while your account is
          active and deleted within 30 days after we verify an account-deletion request, except
          records we must retain by law or for security and dispute resolution.
        </li>
        <li>
          <strong>Uploaded media.</strong> Retained in your Library until you delete it, where the
          file is not attached to an active scheduled transmission, or until your account is
          deleted.
        </li>
        <li>
          <strong>OAuth credentials.</strong> Stored only while the platform connection is active
          or needed to complete an authorized action. Disconnecting a platform deletes its stored
          OAuth tokens from Posterract&apos;s active connection records.
        </li>
        <li>
          <strong>Platform-derived data.</strong> Retained only as long as needed for the features
          described above and refreshed or deleted according to the applicable platform&apos;s rules.
          Google/YouTube deletion commitments are described in the highlighted subsection above.
        </li>
      </ul>
      <p>
        To disconnect a platform, open <strong>Accounts</strong> in Posterract and select
        <strong> Disconnect</strong>. You may also revoke Posterract from the platform&apos;s own
        connected-app settings. To request deletion of your account or remaining platform-derived
        data, email us using the address below. We may ask you to verify account ownership before
        completing the request.
      </p>

      <h2>10. Your choices and rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, export, restrict,
        object to processing of, or delete your personal information. You may exercise these rights
        by contacting us. You may disconnect a social account without deleting your Posterract
        account.
      </p>

      <h2>11. Children&apos;s privacy</h2>
      <p>
        Posterract is not directed to children under 13, and we do not knowingly collect personal
        information from children under 13. Users remain responsible for correctly making any
        platform-required audience or made-for-children designation for content they publish.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this policy as Posterract and platform integrations evolve. We will update the
        date above and provide additional notice when required. If a new use of connected-platform
        data is materially different from this policy, we will obtain any consent required before
        applying that use.
      </p>

      <h2 id="contact">13. Contact and deletion requests</h2>
      <p>
        Questions or deletion requests: <a href="mailto:pahlevansina@gmail.com">pahlevansina@gmail.com</a>
      </p>
    </LegalPage>
  );
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="chamber min-h-screen px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <Link to="/gate" className="mb-8 flex items-center gap-3" aria-label="Posterract home">
          <MiniTesseract size={26} />
          <span className="font-display text-[15px] font-bold tracking-[0.18em] text-starlight">
            POSTER<span className="text-neon">RACT</span>
          </span>
        </Link>
        <h1 className="font-display text-3xl font-bold text-starlight">{title}</h1>
        <p className="telemetry mt-1 text-[11px] text-starlight-faint">Last updated: {updated}</p>
        <div className="legal-body mt-8 space-y-4 text-[14px] leading-relaxed text-starlight-dim">
          {children}
        </div>
        <div className="mt-12 flex gap-6 border-t border-[var(--glass-border)] pt-6 text-[12px] text-starlight-faint">
          <Link to="/privacy" className="hover:text-neon">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-neon">
            Terms of Service
          </Link>
          <Link to="/gate" className="hover:text-neon">
            Sign in
          </Link>
        </div>
      </div>
      <style>{`
        .legal-body h2 { color: var(--starlight); font-family: var(--font-display); font-size: 17px; font-weight: 600; margin-top: 28px; }
        .legal-body h2[id], .legal-body section[id] { scroll-margin-top: 24px; }
        .legal-body h3 { color: var(--starlight); font-family: var(--font-display); font-size: 16px; font-weight: 650; }
        .legal-body ul { list-style: disc; padding-left: 22px; display: grid; gap: 8px; }
        .legal-body a { color: var(--neon); text-decoration: underline; text-underline-offset: 3px; }
        .legal-body strong { color: var(--starlight); }
        .legal-body code { border: 1px solid var(--glass-border); border-radius: 5px; background: rgba(3, 11, 14, 0.52); padding: 1px 5px; color: var(--auroral); font-family: var(--font-mono); font-size: 11px; }
        .legal-lede { color: var(--starlight-dim); font-size: 15px; line-height: 1.75; }
        .legal-summary { border: 1px solid rgba(101, 255, 154, 0.3); border-radius: 12px; background: rgba(101, 255, 154, 0.055); padding: 16px 18px; }
        .legal-toc { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--glass-border); padding: 2px 0 18px; }
        .legal-toc a { border: 1px solid var(--glass-border); border-radius: 999px; padding: 5px 9px; text-decoration: none; color: var(--starlight-dim); font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; }
        .legal-toc a:hover { border-color: rgba(101, 255, 154, 0.45); color: var(--neon); }
        .platform-policy { margin-top: 14px; border: 1px solid var(--glass-border); border-radius: 14px; background: rgba(4, 13, 16, 0.46); padding: 18px; }
        .platform-policy-featured { border-color: rgba(101, 255, 154, 0.42); background: linear-gradient(145deg, rgba(101, 255, 154, 0.065), rgba(4, 13, 16, 0.54)); }
        .platform-policy-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .platform-policy-heading span { border: 1px solid var(--glass-border); border-radius: 999px; padding: 3px 7px; color: var(--starlight-faint); font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; }
        .platform-policy-featured .platform-policy-heading span { border-color: rgba(101, 255, 154, 0.3); color: var(--neon); }
        .google-disclosure { margin-top: 16px; border-left: 3px solid var(--neon); border-radius: 0 10px 10px 0; background: rgba(101, 255, 154, 0.075); padding: 14px 16px; }
        .google-disclosure-kicker { margin-bottom: 7px; color: var(--starlight); font-family: var(--font-display); font-size: 14px; font-weight: 650; }
      `}</style>
    </main>
  );
}
