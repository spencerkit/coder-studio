import { verify } from "node:crypto";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export function canonicalizeJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key] as CanonicalJson)}`)
    .join(",")}}`;
}

export function canonicalSigningPayload(value: object, omittedKey = "signature"): Buffer {
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== omittedKey));
  return Buffer.from(canonicalizeJson(unsigned as CanonicalJson), "utf8");
}

export function verifyEd25519Payload(
  payload: Buffer,
  signature: unknown,
  publicKeyPem: string
): boolean {
  if (!signature || typeof signature !== "object") return false;
  const candidate = signature as { algorithm?: unknown; value?: unknown };
  if (candidate.algorithm !== "ed25519" || typeof candidate.value !== "string") return false;
  try {
    return verify(null, payload, publicKeyPem, Buffer.from(candidate.value, "base64"));
  } catch {
    return false;
  }
}
