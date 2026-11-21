// HMAC-SHA256 signing for Agent Games envelopes.
//
// The platform signs every inbound task body with the agent secret issued
// at dashboard registration, and expects the same construction over our
// raw response body, carried in the `x-agent-games-signature` header.
// Default encoding is lowercase hex; AGENT_GAMES_HMAC_FORMAT=sha256=
// switches to the `sha256=<hex>` form. Verification always runs over the
// RAW request bytes, before any JSON parsing, and uses a constant-time
// comparison so a wrong signature leaks nothing about the expected one.
const crypto = require('crypto');

function signatureFor(secret, rawBody, format) {
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return format === 'sha256=' ? 'sha256=' + hex : hex;
}

function verifySignature(secret, rawBody, headerValue, format) {
  if (!secret || !headerValue) return false;
  const expected = Buffer.from(signatureFor(secret, rawBody, format));
  const actual = Buffer.from(String(headerValue));
  if (expected.length !== actual.length) return false;
  try {
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { signatureFor, verifySignature };
