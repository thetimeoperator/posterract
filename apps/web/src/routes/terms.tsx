import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./privacy";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="August 20, 2026">
      <h2>The service</h2>
      <p>
        Posterract is a content-agent harness and social publishing service. It lets you connect
        any AI model accessible through an API key you supply, use Posterract&apos;s private skills, keep agent
        chats, upload short-form video content, connect social media accounts, and schedule or
        publish content. By creating an account you agree to these terms.
      </p>

      <h2>Your content and your accounts</h2>
      <ul>
        <li>
          You retain all rights to the content and prompts you submit. You grant Posterract the
          technical permission needed to store them, process them with the skills and model
          provider you select, and transmit approved posts to the social platforms you select.
        </li>
        <li>
          You are responsible for the content you publish and for complying with each destination
          platform&apos;s terms of service and community guidelines.
        </li>
        <li>
          You may only connect social media accounts you own or are authorized to manage.
        </li>
      </ul>

      <h2>Agent connections, chats, and model providers</h2>
      <ul>
        <li>
          You may connect only model-provider credentials you own or are authorized to use. You are
          responsible for the provider account, its charges, usage limits, model availability, and
          compliance with the provider&apos;s terms.
        </li>
        <li>
          When you run an agent, Posterract sends your prompt, limited recent chat context, and the
          private-skill instructions needed for that run to the model provider you selected. The
          provider processes that request under its own terms, privacy policy, account settings,
          and retention rules. Posterract does not control the provider&apos;s output or data practices.
        </li>
        <li>
          Agent output can be inaccurate, incomplete, or unsuitable for publication. You are
          responsible for reviewing generated content and confirming that you have the rights and
          approvals required before scheduling or publishing it.
        </li>
      </ul>

      <h2>Hosting, storage, and data processing</h2>
      <p>
        Posterract&apos;s core web application, API, PostgreSQL database, publishing workers, and
        supporting workflow services run as a Docker Compose stack on a privately managed virtual
        private server (&quot;VPS&quot;). Account, workspace, chat, schedule, publishing-history,
        analytics, and credential records are stored in PostgreSQL and supporting persistent
        volumes on that VPS. Uploaded video bytes are stored separately in private Cloudflare R2
        object storage and ordinarily upload directly from your browser using temporary signed
        URLs. See the <a href="/privacy">Privacy Policy</a> for the categories stored in each system,
        security measures, third-party processing, retention, and deletion rules.
      </p>
      <p>
        Posterract is not permanent archival or backup storage. Media may be automatically removed
        after upload or publication according to the retention periods in the Privacy Policy. You
        should keep your own copies of any content you cannot replace.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You may not use Posterract to publish content that is illegal, infringes others&apos;
        rights, or violates the policies of the destination platforms; to send spam or engage in
        coordinated inauthentic behavior; or to attempt to disrupt or gain unauthorized access to
        the service. We may suspend accounts that violate these rules.
      </p>

      <h2>Scheduling and publishing</h2>
      <p>
        Posterract publishes on a best-effort basis at your scheduled times. Publishing depends on
        the destination platforms&apos; APIs, which impose their own rate limits, content rules, and
        occasional outages; a platform may reject or delay a post for reasons outside our control.
        Failed posts are reported in the product and can be retried.
      </p>

      <h2>YouTube</h2>
      <p>
        If YouTube access is made available, by connecting or using YouTube through Posterract you
        agree to be bound by the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>
        . You remain responsible for ensuring that every upload complies with YouTube&apos;s terms,
        Community Guidelines, copyright rules, and required disclosures. You control each
        upload&apos;s title, description, visibility, audience setting, and synthetic-content
        disclosure before publishing.
      </p>

      <h2>Facebook, Instagram, and Threads</h2>
      <p>
        By connecting or using Facebook, Instagram, or Threads through Posterract, you agree to
        comply with the applicable Meta product terms, including the{" "}
        <a href="https://www.facebook.com/legal/terms" target="_blank" rel="noreferrer">
          Meta Terms of Service
        </a>
        , the{" "}
        <a href="https://help.instagram.com/581066165581870/" target="_blank" rel="noreferrer">
          Instagram Terms of Use
        </a>
        , the{" "}
        <a href="https://help.instagram.com/769983657850450" target="_blank" rel="noreferrer">
          Threads Supplemental Terms
        </a>
        , and applicable community and developer policies. You may connect only Pages and
        professional accounts you own or are authorized to manage. Posterract acts only on the
        publishing and analytics instructions you provide; Meta may independently reject, remove,
        restrict, or delay content or API access under its policies.
      </p>
      <p>
        Posterract reviews the legality and scope of public-authority requests for personal data
        received through Meta products. Where reasonable and legally permitted, we challenge
        requests we believe are unlawful, invalid, or overbroad; disclose only the minimum
        information legally required; and document the request, response, legal reasoning,
        disclosure, and decision-makers except where documentation is prohibited by law.
      </p>

      <h2>Fees</h2>
      <p>
        Posterract may offer free trials, free access, or paid subscription plans. Current pricing,
        billing period, included usage, and renewal terms are presented before purchase. Some
        destination platforms may also impose platform-side fees or usage limits; where applicable,
        those are separate from Posterract&apos;s fees and are surfaced in the product or relevant
        platform documentation.
      </p>

      <h2>Disclaimer and liability</h2>
      <p>
        The service is provided &quot;as is&quot; without warranties of any kind. To the maximum
        extent permitted by law, Posterract is not liable for indirect or consequential damages,
        lost profits, or lost content arising from use of the service.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using Posterract and request account deletion at any time. We may suspend or
        terminate accounts that violate these terms.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the product evolves; material changes will be announced in the
        product. Continued use after changes constitutes acceptance.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:pahlevansina@gmail.com">pahlevansina@gmail.com</a>
      </p>
    </LegalPage>
  );
}
