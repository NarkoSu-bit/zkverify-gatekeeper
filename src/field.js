// Field arithmetic for the BN254 (alt_bn128) curve used by the Gatekeeper
// circuit. All circuit inputs are field elements, so every number that
// enters the witness must be reduced modulo the field prime first.
const { keccak_256 } = require('js-sha3');

// BN254 scalar field prime.
const FIELD_PRIME = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// Reduce any integer (bigint, number, decimal string or 0x-hex string) into
// the field. Negative values wrap around to their positive representative.
function toField(value) {
  const n =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number'
        ? BigInt(value)
        : BigInt(value); // decimal or 0x-hex string
  const reduced = n % FIELD_PRIME;
  return reduced < 0n ? reduced + FIELD_PRIME : reduced;
}

// keccak256 over the concatenated buffers, reduced modulo the field prime.
// Used to map an arbitrary string task id to a single field element.
function keccak256ModP(buffers) {
  const hex = '0x' + keccak_256(Buffer.concat(buffers));
  return toField(BigInt(hex));
}

module.exports = { FIELD_PRIME, toField, keccak256ModP };
