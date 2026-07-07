import { Link, createFileRoute } from "@tanstack/react-router";
import { MiniTesseract } from "@posterract/hyperkit";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="July 6, 2026">
      <h2>What Posterract does</h2>
      <p>
        Posterract (accessible at posterract.app) is a social media scheduling service. You upload
        short-form videos, write captions, connect your social media accounts, and Posterract
        publishes your content to those platforms at the times you choose — either through the web
        app or through our API.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your name, email address, and a hashed password when
          you create an account.
        </li>
        <li>
          <strong>Content you upload.</strong> Video files, captions, hashtags, and scheduling
          preferences you create in the product.
        </li>
        <li>
          <strong>Connected platform credentials.</strong> When you connect a social media account
          (Instagram, TikTok, YouTube, X, Threads, Facebook), we store the access tokens those
          platforms issue so we can publish on your behalf. We request only the permissions needed
          to publish your content and read its performance metrics. We never store your social
          media passwords.
        </li>
        <li>
          <strong>Post metadata and metrics.</strong> Publish results (post IDs, URLs, statuses) and,
          where you enable it, view/engagement counts returned by the platforms for your own posts.
        </li>
      </ul>

      <h2>What we do NOT do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>We do not post to your accounts except as you schedule or instruct.</li>
        <li>We do not read your private messages or data beyond the permissions listed above.</li>
        <li>We do not use your content to train AI models.</li>
      </ul>

      <h2>Where your data lives</h2>
      <p>
        Data is stored with our infrastructure providers: Convex (database, file storage, and
        scheduling) and Vercel (web hosting). Data is encrypted in transit. Platform access tokens
        are stored server-side and are never exposed to your browser or to other users.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        Your data remains in your workspace until you delete it. You can delete individual videos
        and posts in the product, disconnect any connected platform at any time (which invalidates
        our access to it), or delete your account entirely by contacting us — we will remove your
        account and associated data within 30 days.
      </p>

      <h2>Third-party platforms</h2>
      <p>
        Publishing through Posterract is governed by each destination platform&apos;s own terms and
        privacy policies (Meta, TikTok, Google/YouTube, X). Revoking Posterract&apos;s access from a
        platform&apos;s own settings page also stops our ability to publish there.
      </p>

      <h2>Contact</h2>
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
      <div className="mx-auto max-w-2xl">
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
        .legal-body ul { list-style: disc; padding-left: 22px; display: grid; gap: 8px; }
        .legal-body a { color: var(--neon); text-decoration: underline; text-underline-offset: 3px; }
        .legal-body strong { color: var(--starlight); }
      `}</style>
    </main>
  );
}
