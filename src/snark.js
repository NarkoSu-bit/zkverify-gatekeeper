// Thin snarkjs wrapper around the official Gatekeeper circuit artifacts.
// The artifacts live in ./circuits (downloaded once from the official
// Agent Games site; see scripts/fetch-circuits.js). They are binary files
// and are intentionally NOT committed to git.
const path = require('path');
const snarkjs = require('snarkjs');

const WASM_PATH = path.join(__dirname, '..', 'circuits', 'gatekeeper.wasm');
const ZKEY_PATH = path.join(__dirname, '..', 'circuits', 'gatekeeper_final.zkey');

// The verification key is exported once and cached; it is also what the
// platform checks our proofs against (vk hash 0x6b79c6…d77b0).
let verificationKeyPromise = null;
function getVerificationKey() {
  if (!verificationKeyPromise) {
    verificationKeyPromise = snarkjs.zKey.exportVerificationKey(ZKEY_PATH);
  }
  return verificationKeyPromise;
}

// Generate a Groth16 proof for a prepared circuit input. Returns
// { proof, publicSignals } exactly as snarkjs produces them.
async function prove(input) {
  return snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
}

// Verify a proof against the official verification key, locally.
async function verifyLocally(publicSignals, proof) {
  const vk = await getVerificationKey();
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

module.exports = { prove, verifyLocally, getVerificationKey, WASM_PATH, ZKEY_PATH };
