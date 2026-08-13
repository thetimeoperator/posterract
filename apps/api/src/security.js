import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function encryptionKey(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  }

  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes (64 hex characters or base64)",
    );
  }
  return key;
}

export function constantTimeEqual(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function hashApiKey(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashRequest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function encryptSecret(value, keyValue = process.env.TOKEN_ENCRYPTION_KEY) {
  if (value === undefined || value === null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  const plaintext = Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`,
    "utf8",
  );
}

export function decryptSecret(value, keyValue = process.env.TOKEN_ENCRYPTION_KEY) {
  if (value === undefined || value === null) return undefined;
  const envelope = Buffer.isBuffer(value)
    ? value.toString("utf8")
    : String(value);
  const [version, ivValue, tagValue, ciphertextValue, ...rest] =
    envelope.split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    rest.length > 0
  ) {
    throw new Error("Unsupported encrypted secret envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyValue),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
