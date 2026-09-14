/**
 * The five agents the service runs. They are the five skills that ship with
 * Posterract, so every line here describes something the product does today.
 */
export type Agent = {
  id: string;
  n: string;
  name: string;
  /** The one-line description the ops terminal prints when the agent is hired. */
  line: string;
  /** What the agent makes, for its card. */
  makes: string;
  /** What the operator sets up for it, for its card. */
  sets: string;
  src: string;
  poster: string;
};

export const AGENTS: Agent[] = [
  {
    id: "clip",
    n: "01",
    name: "Clipping",
    line: "long talks → 9:16 clips, hook inside two seconds",
    makes: "Cuts a long talk into vertical clips that open on the line that matters, with a punch-in on the speaker.",
    sets: "Which speakers, which moments count, the caption style, your handle on the frame.",
    src: "/brand/agency/clipping.mp4",
    poster: "/brand/agency/clipping.jpg",
  },
  {
    id: "lead",
    n: "02",
    name: "Lead With Animations",
    line: "explainers that open with motion, three-word captions",
    makes: "Explainers that open with an animation and carry the story in three-word captions.",
    sets: "Your brand marks, the motion language, the topics it may cover.",
    src: "/brand/agency/lead-with-animations.mp4",
    poster: "/brand/agency/lead-with-animations.jpg",
  },
  {
    id: "talk",
    n: "03",
    name: "Talking Characters",
    line: "two voices, one scene, scripted from a brief",
    makes: "Two characters talking a topic through, scripted and voiced from a one-paragraph brief.",
    sets: "The characters, their voices, what they are allowed to say.",
    src: "/brand/agency/talking-characters.mp4",
    poster: "/brand/agency/talking-characters.jpg",
  },
  {
    id: "news",
    n: "04",
    name: "Trending News",
    line: "the story, sourced and verified, within the hour",
    makes: "A trending story turned into a short with an avatar and animation, sources checked before it is made.",
    sets: "The sources it may cite, your angle, the topics it stays away from.",
    src: "/brand/agency/trending-news.mp4",
    poster: "/brand/agency/trending-news.jpg",
  },
  {
    id: "ugc",
    n: "05",
    name: "UGC Ad",
    line: "product in hand, two clip blocks, captions burned in",
    makes: "A creator-style ad: your product in hand, two clip blocks, captions burned in, ready to post.",
    sets: "Product photos, the avatar, the claims it may make.",
    src: "/brand/agency/ugc.mp4",
    poster: "/brand/agency/ugc.jpg",
  },
];
