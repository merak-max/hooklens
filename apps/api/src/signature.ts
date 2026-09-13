import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(secret: string, payload: Buffer) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function verifySignature(secret: string, payload: Buffer, value?: string) {
  if (!value) return { provided: false, valid: false };
  const expected = Buffer.from(signPayload(secret, payload));
  const actual = Buffer.from(value.trim());
  return {
    provided: true,
    valid: expected.length === actual.length && timingSafeEqual(expected, actual),
  };
}
