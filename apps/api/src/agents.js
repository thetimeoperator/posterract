import { decryptSecret } from "./security.js";
import { outputLeaksSkillSource, resolveSkillChain } from "./skills.js";

const PROVIDERS = new Set(["openai", "anthropic", "gemini", "openrouter"]);

export function validateAgentCredentialInput(body) {
  const provider = body?.provider;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  const secret = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (!PROVIDERS.has(provider)) throw new Error("Unsupported agent provider");
  if (!label || label.length > 80) throw new Error("Connection name is required");
  if (!model || model.length > 120) throw new Error("Model is required");
  if (secret.length < 8 || secret.length > 512) throw new Error("Provider key is invalid");
  return { provider, label, model, secret };
}

export function validateAgentRunInput(body) {
  const message = body?.message;
  if (typeof message !== "string" || message.trim().length === 0 || message.length > 20_000) {
    throw new Error("Message must be between 1 and 20,000 characters");
  }
  const chain = resolveSkillChain(body?.skillIds);
  return { message: message.trim(), skillIds: Object.keys(chain.versions) };
}

/** Verify a user-supplied key without spending inference tokens. */
export async function validateProviderCredential({ provider, secret, signal }) {
  const requests = {
    openai: ["https://api.openai.com/v1/models?limit=1", { Authorization: `Bearer ${secret}` }],
    anthropic: ["https://api.anthropic.com/v1/models?limit=1", { "x-api-key": secret, "anthropic-version": "2023-06-01" }],
    gemini: ["https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": secret }],
    openrouter: ["https://openrouter.ai/api/v1/auth/key", { Authorization: `Bearer ${secret}` }],
  };
  const [url, headers] = requests[provider] ?? [];
  if (!url) throw new Error("Unsupported agent provider");
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.error?.message ?? payload?.message;
    throw new Error(String(detail ?? `Provider rejected the credential (${response.status})`).slice(0, 220));
  }
}

export async function executeAgentRun({ credential, skillIds, message, signal }) {
  const chain = resolveSkillChain(skillIds);
  const secret = decryptSecret(credential.secret_ciphertext);
  let output;
  if (credential.provider === "openai") {
    output = await callOpenAI(secret, credential.model, chain.instructions, message, signal);
  } else if (credential.provider === "anthropic") {
    output = await callAnthropic(secret, credential.model, chain.instructions, message, signal);
  } else if (credential.provider === "gemini") {
    output = await callGemini(secret, credential.model, chain.instructions, message, signal);
  } else if (credential.provider === "openrouter") {
    output = await callOpenRouter(secret, credential.model, chain.instructions, message, signal);
  } else {
    throw new Error("Unsupported agent provider");
  }
  if (!output || outputLeaksSkillSource(output)) throw new Error("Agent output was blocked by the private-skill boundary");
  return { output, versions: chain.versions };
}

async function providerFetch(url, init, signal) {
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message ?? `Provider request failed (${response.status})`;
    throw new Error(String(message).slice(0, 300));
  }
  return payload;
}

async function callOpenAI(secret, model, instructions, message, signal) {
  const payload = await providerFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input: message }),
  }, signal);
  if (typeof payload.output_text === "string") return payload.output_text;
  return payload.output?.flatMap((item) => item.content ?? []).map((part) => part.text).filter(Boolean).join("\n") ?? "";
}

async function callAnthropic(secret, model, instructions, message, signal) {
  const payload = await providerFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": secret, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 3000, system: instructions, messages: [{ role: "user", content: message }] }),
  }, signal);
  return payload.content?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
}

async function callGemini(secret, model, instructions, message, signal) {
  const safeModel = encodeURIComponent(model.replace(/^models\//, ""));
  const payload = await providerFetch(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: "user", parts: [{ text: message }] }] }),
  }, signal);
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
}

async function callOpenRouter(secret, model, instructions, message, signal) {
  const payload = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "X-Title": "Posterract" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: message }] }),
  }, signal);
  return payload.choices?.[0]?.message?.content ?? "";
}
