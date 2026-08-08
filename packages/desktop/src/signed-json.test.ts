import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeJson, canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

describe("signed JSON", () => {
  it("canonicalizes nested object keys deterministically", () => {
    expect(canonicalizeJson({ z: 1, a: { y: true, b: [2, null] } })).toBe(
      '{"a":{"b":[2,null],"y":true},"z":1}'
    );
  });

  it("verifies Ed25519 signatures without including the signature field", () => {
    const keys = generateKeyPairSync("ed25519");
    const unsigned = { schemaVersion: 1, value: "signed" };
    const signature = sign(null, canonicalSigningPayload(unsigned), keys.privateKey).toString(
      "base64"
    );
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

    expect(
      verifyEd25519Payload(
        canonicalSigningPayload({
          ...unsigned,
          signature: { algorithm: "ed25519", value: signature },
        }),
        { algorithm: "ed25519", value: signature },
        publicKey
      )
    ).toBe(true);
  });
});
