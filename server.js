// Proof Gatekeeper agent — zkVerify Agent Games, Season 01.
//
// Plain Node.js http server, no framework. Endpoints:
//   GET  /health             -> status, including the startup proof self-test
//   POST /agent              -> signed task envelope in, signed decision + proof out
//   POST /gatekeeper         -> same handler (alias; the platform POSTs to
//                               whichever URL is registered on the dashboard)
//
// Behaviour:
// - Inbound HMAC is verified over the RAW body before JSON parsing, when a
//   secret is configured (AGENT_GAMES_HMAC_SECRET from the dashboard).
//   Without a secret the check is skipped and a warning is logged —
//   set the secret before going live.
// - Every response is signed with x-agent-games-signature over its raw body.
// - Preflight envelopes {"type":"agent-games.preflight.v1"} are answered
//   {ok:true, protocolVersion:"v1"}.
// - PROOF_REUSED answers carry no proof (the platform excludes them from
//   the reliability bonus). If proof generation ever fails, the decision is
//   still returned without a proof rather than crashing (fail visible).
// - The platform wraps the condition fields in `input`; decide/prove work
//   on the flat shape (task_id stays at envelope level).
// - Task ids are idempotency keys: a retry of the same task_id is served
//   again, a reused proof_tx under another task_id is REJECTed.
const http = require('http');
const fs = require('fs');
const { signatureFor, verifySignature } = require('./src/hmac');
const { decide } = require('./src/decide');
const { proveTask } = require('./src/prove');
const { verifyLocally, WASM_PATH, ZKEY_PATH } = require('./src/snark');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const HMAC_SECRET = process.env.AGENT_GAMES_HMAC_SECRET || '';
const HMAC_FORMAT = process.env.AGENT_GAMES_HMAC_FORMAT || 'hex';
const TASK_ID_MODE = process.env.GATEKEEPER_TASK_ID_MODE || 'keccak';

// Official verification-key hash for the Gatekeeper circuit.
const VK_HASH = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

let selfTest = 'pending';

// Prove + locally verify one known-valid task at startup, so /health can
// report whether the circuit path actually works before any live task.
async function runSelfTest() {
  const task = {
    task_id: 'selftest_1',
    registered_vk: VK_HASH,
    proof_vk: VK_HASH,
    minimum: '1000',
    public_balance: '1460',
    expiry_block: '8430000',
    current_block: '8420000',
    recipient: '12345',
    condition_recipient: '12345',
    amount: '500',
    max_transfer: '1000',
    proof_tx: '0xselftest',
  };
  try {
    const { decision } = decide(task);
    const { proof, publicSignals } = await proveTask(task, decision, TASK_ID_MODE);
    const ok = await verifyLocally(publicSignals, proof);
    selfTest = ok ? 'PASS' : 'FAIL (proof did not verify)';
  } catch (e) {
    selfTest = 'FAIL (' + e.message + ')';
  }
  console.log('[selftest] gatekeeper proof self-test:', selfTest);
}

function sendSigned(res, status, obj) {
  const body = JSON.stringify(obj);
  const headers = { 'content-type': 'application/json' };
  if (HMAC_SECRET) {
    headers['x-agent-games-signature'] = signatureFor(HMAC_SECRET, body, HMAC_FORMAT);
  }
  res.writeHead(status, headers);
  res.end(body);
}

async function handleTask(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    if (
      HMAC_SECRET &&
      !verifySignature(HMAC_SECRET, raw, req.headers['x-agent-games-signature'], HMAC_FORMAT)
    ) {
      return sendSigned(res, 401, { ok: false, error: 'bad signature' });
    }
    let envelope;
    try {
      envelope = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendSigned(res, 400, { ok: false, error: 'invalid json' });
    }
    if (envelope && envelope.type === 'agent-games.preflight.v1') {
      return sendSigned(res, 200, { ok: true, protocolVersion: 'v1' });
    }
    try {
      const started = Date.now();
      const input =
        envelope && typeof envelope.input === 'object' && envelope.input ? envelope.input : {};
      const flatTask = { ...input, task_id: envelope.task_id };
      const { decision, reason_code } = decide(flatTask);
      const out = { decision, reason_code };
      if (flatTask.proof_tx) out.proof_tx = flatTask.proof_tx;
      if (reason_code !== 'PROOF_REUSED') {
        try {
          const { proof, publicSignals } = await proveTask(flatTask, decision, TASK_ID_MODE);
          out.proof = proof;
          out.public_signals = publicSignals;
        } catch (e) {
          console.error('[gatekeeper] proof failed for', envelope.task_id, e.message);
          out.proof_error = 'proof generation failed';
        }
      }
      console.log(
        '[gatekeeper]',
        envelope.task_id,
        decision,
        reason_code,
        Date.now() - started + 'ms'
      );
      return sendSigned(res, 200, out);
    } catch (e) {
      console.error('[gatekeeper] handler error', e);
      return sendSigned(res, 500, { ok: false, error: 'handler error' });
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendSigned(res, 200, {
      ok: true,
      agent: 'proof-gatekeeper',
      hmacConfigured: Boolean(HMAC_SECRET),
      taskIdMode: TASK_ID_MODE,
      selfTest,
    });
  }
  if (
    req.method === 'POST' &&
    (req.url === '/agent' || req.url === '/gatekeeper')
  ) {
    return handleTask(req, res);
  }
  return sendSigned(res, 404, { ok: false, error: 'not found' });
});

// The circuit artifacts must exist before the server can prove anything.
if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH)) {
  console.error('[circuits] missing artifacts in ./circuits — run: npm run fetch-circuits');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(
    `[gatekeeper] listening on ${HOST}:${PORT} (hmac ${
      HMAC_SECRET ? 'on' : 'OFF — set AGENT_GAMES_HMAC_SECRET before going live'
    }, taskIdMode ${TASK_ID_MODE})`
  );
  runSelfTest();
});
