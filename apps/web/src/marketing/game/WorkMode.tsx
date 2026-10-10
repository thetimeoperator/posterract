import type { ReactNode } from "react";
import { AgencyFinalCta, AgencyHero, Faq, HowItRuns, Team } from "@/marketing/agency";
import "@/styles/homepage.css";
import "@/styles/homepage-readability.css";
import "@/styles/landing-two-mode.css";
import "@/styles/landing-cyan.css";

/**
 * Work with me, as it is on the current page: the same sections, the same
 * cyan stylesheets, inside the same `.site` scope, so nothing approved moves.
 * Only the WebGL world and its star, grid and aurora layers are gone. This
 * file, its components and those stylesheets load when the lever is thrown.
 */
export default function WorkMode({ lever, onProduct }: { lever: ReactNode; onProduct: () => void }) {
  return (
    <div className="site g-work" data-palette="cyan">
      <section className="site-hero site-hero-landing site-hero-work" aria-labelledby="site-title">
        <div className="site-hero-shade" aria-hidden="true" />
        <AgencyHero fork={lever} />
      </section>
      <HowItRuns />
      <Team />
      <Faq />
      <AgencyFinalCta onProduct={onProduct} />
    </div>
  );
}
