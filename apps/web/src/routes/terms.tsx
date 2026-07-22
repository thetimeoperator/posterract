import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./privacy";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="July 21, 2026">
      <h2>The service</h2>
      <p>
        Posterract lets you upload short-form video content, connect your social media accounts, and
        schedule or publish that content to those accounts. By creating an account you agree to
        these terms.
      </p>

      <h2>Your content and your accounts</h2>
      <ul>
        <li>
          You retain all rights to the content you upload. You grant Posterract only the technical
          permission to store it and transmit it to the platforms you select.
        </li>
        <li>
          You are responsible for the content you publish and for complying with each destination
          platform&apos;s terms of service and community guidelines.
        </li>
        <li>
          You may only connect social media accounts you own or are authorized to manage.
        </li>
      </ul>

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
        By connecting or using YouTube through Posterract, you agree to be bound by the{" "}
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
