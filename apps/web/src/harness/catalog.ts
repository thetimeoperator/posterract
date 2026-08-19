import type { PlatformId } from "@posterract/contract";

export type AgentProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export type AgentProvider = {
  id: AgentProviderId;
  name: string;
  short: string;
  description: string;
  models: string[];
  keyPrefix: string;
};

export const AGENT_PROVIDERS: AgentProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    short: "OA",
    description: "Connect GPT and reasoning models with your own account.",
    models: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"],
    keyPrefix: "sk-",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    short: "AN",
    description: "Use Claude models as the intelligence inside your harness.",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    keyPrefix: "sk-ant-",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    short: "GM",
    description: "Connect Gemini models for multimodal content work.",
    models: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview"],
    keyPrefix: "AIza",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    short: "OR",
    description: "Reach a broad model catalog through one credential.",
    models: ["openrouter/auto", "anthropic/claude-sonnet-4", "google/gemini-3.5-flash"],
    keyPrefix: "sk-or-",
  },
];

export type SkillCategory = "research" | "strategy" | "writing" | "production" | "distribution";

export type PublicSkill = {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  result: string;
  inputs: string[];
  platforms: PlatformId[];
  stages: number;
  version: string;
  accent: string;
  featured?: boolean;
};

/** Safe metadata only. Skill instructions and tool recipes remain server-side. */
export const PUBLIC_SKILLS: PublicSkill[] = [
  {
    id: "trend-radar",
    name: "Viral Research Radar",
    category: "research",
    description: "Find the strongest timely angle, verify the claim, and turn noise into a usable creative brief.",
    result: "Ranked story brief with evidence, angle, tension, and audience fit.",
    inputs: ["Topic or niche", "Audience", "Freshness window"],
    platforms: ["instagram", "tiktok", "facebook", "threads"],
    stages: 4,
    version: "2.4",
    accent: "#7cf7ff",
    featured: true,
  },
  {
    id: "hook-architect",
    name: "Hook Architect",
    category: "strategy",
    description: "Generate scroll-stopping opening systems matched to the idea, format, and viewer awareness level.",
    result: "Five ranked hooks with pattern, visual beat, and payoff promise.",
    inputs: ["Core idea", "Audience", "Tone"],
    platforms: ["instagram", "tiktok", "facebook", "threads"],
    stages: 3,
    version: "3.1",
    accent: "#65ff9a",
    featured: true,
  },
  {
    id: "shortform-script",
    name: "Short-Form Script Engine",
    category: "writing",
    description: "Build a retention-shaped script with a clean hook, escalating beats, proof, and a natural CTA.",
    result: "Production-ready script with beats, captions, and timing guidance.",
    inputs: ["Creative brief", "Target length", "Voice"],
    platforms: ["instagram", "tiktok", "facebook"],
    stages: 5,
    version: "4.0",
    accent: "#a7ffcc",
    featured: true,
  },
  {
    id: "talking-video",
    name: "Talking-Video Director",
    category: "production",
    description: "Convert a script into a shot, pacing, caption, b-roll, and edit blueprint for vertical video.",
    result: "Timed production plan with caption and edit instructions.",
    inputs: ["Script", "Presenter format", "Available media"],
    platforms: ["instagram", "tiktok", "facebook"],
    stages: 6,
    version: "2.8",
    accent: "#ffd28a",
  },
  {
    id: "caption-multiplier",
    name: "Caption Multiplier",
    category: "distribution",
    description: "Adapt one idea into platform-native captions without flattening the original voice.",
    result: "Approved-platform caption variants with hashtags and CTA options.",
    inputs: ["Base message", "Brand voice", "Platform targets"],
    platforms: ["instagram", "tiktok", "facebook", "threads"],
    stages: 3,
    version: "2.2",
    accent: "#9be8ff",
  },
  {
    id: "character-news",
    name: "News Character Studio",
    category: "production",
    description: "Turn a verified news angle into a repeatable character-led short-form episode structure.",
    result: "Character script, scene plan, caption pack, and publishing notes.",
    inputs: ["Verified brief", "Character", "Episode format"],
    platforms: ["instagram", "tiktok", "facebook", "threads"],
    stages: 7,
    version: "1.9",
    accent: "#ff9fb4",
  },
];

export const skillById = (id: string) => PUBLIC_SKILLS.find((skill) => skill.id === id);
