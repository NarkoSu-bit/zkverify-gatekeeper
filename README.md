# zkVerify Agent Games — Proof Gatekeeper agent

Entry for **zkVerify Agent Games, Season 01** (21 Oct – 21 Nov 2026,
400,000 VFY pool, 100,000 VFY per track, split 50/30/20 for the top 3).
Track: **Proof Gatekeeper**. Built fresh, plain Node.js, no framework.

## What it does

`POST /agent` (alias `POST /gatekeeper`) receives a signed task envelope
from the platform, verifies the HMAC over the raw body, applies the
deterministic 7-trap checklist, and answers with the decision plus a
Groth16 proof generated locally with snarkjs and the official circuit
artifacts (`circuits/`, vk hash `0x6b79c6…d77b0`). Responses are signed
with `x-agent-games-signature`.

Decision checklist, in order (first failing trap wins):
`VK_SUBSTITUTION` → `PROOF_REUSED` → `THRESHOLD_MISMATCH` →
`EXPIRED_CONDITION` → `RECIPIENT_MISMATCH` → `AMOUNT_OVERFLOW` →
`VALID_CONDITION` (APPROVE). Boundaries: balance == minimum is valid,
current == expiry is expired (strict), amount == max is valid.
Scoring: correct +12, wrong APPROVE −6, wrong REJECT −3, timeout /
missing proof −2, reliability bonus +0..+5. Daily rounds: 8 tasks per
agent per round.

## Run locally

```bash
npm install
npm run fetch-circuits   # downloads gatekeeper.wasm + gatekeeper_final.zkey
cp .env.example .env     # fill AGENT_GAMES_HMAC_SECRET after registration
node server.js           # or: PORT=8080 node server.js
node test.js             # decision harness + real proof verification
```

`GET /health` reports status, including a startup proof self-test
(`PASS` means the circuit path works end to end).

## HMAC secret

The dashboard issues a 32-byte random secret when an agent is registered
(shown once). Put it in `.env` as `AGENT_GAMES_HMAC_SECRET` and restart.
Never commit it. Without it, inbound HMAC verification is disabled and
responses are unsigned — fine for local testing, never for going live.

One open protocol item: the envelope `task_id` is a string and the circuit
needs a field element. Default `GATEKEEPER_TASK_ID_MODE=keccak`
(keccak256 of the id, mod p). Alternatives: `numeric`, `hex`. Confirm
against a practice task after registration; if the platform rejects the
proof, switch the mode and re-test.

## Deploy

The platform needs a **public HTTPS endpoint, standard port, no custom
ports**. This VM has no public inbound address (NAT + egress proxy), and
tunnel services are blocked from here (localtunnel.me and trycloudflare.com
both answer 403 through the proxy), so the agent cannot be served from
this VM.

Recommended path — **Railway** (free): a new account gets a $5 trial
credit for 30 days, no card required; after that a Free plan gives $1 of
credit per month, which covers one minimal always-on Node service
(~$0.80–$1.00/month). Deploy from this repo via GitHub connect or
`railway up`. Set `AGENT_GAMES_HMAC_SECRET` in Railway's environment
variables. Caveat: free-tier services may sleep after inactivity and wake
on the next request — the platform retries generously before forfeiting a
task, but keep the service warm if possible. Creating the Railway account
is the owner's action (GitHub/email sign-up).

Alternatives (not tested): Render free tier (sleeps after inactivity —
risky for scored rounds), Vercel/Netlify serverless (would need the
handler adapted to a function; cold starts may eat into the 60 s
deadline). Fly.io needs a card for the free tier — not used.

## Status / open items

- [x] Decision logic + proof generation, locally tested
- [x] Official circuit artifacts downloaded and verified locally
- [ ] Dashboard registration (needs the owner to sign in and connect a
      wallet or X from their phone)
- [ ] Paste dashboard HMAC secret into `.env`, restart
- [ ] Public HTTPS hosting (Railway, owner creates the account)
- [ ] Register the endpoint URL on the dashboard, run preflight + a
      practice task to confirm the HMAC format and the taskId mode
- [ ] Watch the first scored round; keep the service up

## Notes

- `proof_tx` values are remembered in memory (Map) to detect reuse.
  A restart clears that memory — a reused proof sent right after a
  restart would not be caught. Acceptable for the tournament; the
  platform also tracks reuse itself.
- Responses are produced well inside the 60 s deadline (proof generation
  is sub-second once warm; the first proof after a cold start takes
  longer while the wasm loads).
