# Stateless Serverless Migration TDD Plan

## Goal

Move the draft game from an in-memory Node server to a serverless-ready architecture where every request can be handled independently, while keeping game logic authoritative on the server.

The app must support many concurrent players without shared in-memory draft state, must be deployable to a serverless host, and must protect the game from obvious tampering and API abuse.

## Current State

Current runtime:

- `app/server.js` runs a long-lived Node HTTP server.
- Drafts are stored in process memory with `const drafts = new Map()`.
- `app/gameEngine.js` owns most game rules.
- `app/public/app.js` stores only the current visible draft response.
- Card data is loaded from `data/team_board_pools_hockey_reference_enriched.csv`.

Current strengths:

- Most core game rules are already server-side.
- The frontend does not calculate final scores as truth.
- Every selected card is validated server-side.
- Hidden board ratings are only returned when `reveal_ratings` is used.

Current production gaps:

- Server restart loses active drafts.
- Serverless deployment will not preserve `drafts`.
- Multiple API instances cannot share in-memory draft state.
- No real rate limiting.
- No signed state token.
- No origin/CORS policy.
- No max request/action limits beyond body size.
- CSV data is parsed at server startup, which is acceptable locally but not ideal for serverless cold starts.

Important product decision:

We do not care if a game survives server restart. We do care that many users can play at once and that the API cannot be trivially abused.

## Target Architecture

Use stateless API requests with signed draft state.

The server does not store draft sessions. Instead, every response returns:

- Public game state for rendering.
- A signed draft token containing the authoritative draft state needed for the next request.

The client stores the signed draft token and sends it back with the next action.

The client may store the token locally, but it cannot edit the token without invalidating the signature.

The card pool remains server-side. The client must never receive the full card dataset.

For serverless performance, the API should load a prebuilt compact JSON artifact instead of parsing CSV at request time.

## Core Rule

The client can carry state, but the server owns truth.

Never trust these from the client:

- Final score.
- Ring result.
- Player rating.
- OPS/DPS/GPS.
- Board contents.
- Whether a card is selectable.
- Whether a lifeline is still available.

The client may send:

- Signed draft token.
- Requested action.
- Selected `cardId`.
- Requested lifeline type.
- Requested lifeline position, when applicable.

## Signed Draft Token

Use HMAC signing with a server-only secret.

Environment variable:

```text
DRAFT_STATE_SECRET=<long random secret>
```

Production rule:

- `DRAFT_STATE_SECRET` is required when `NODE_ENV=production`.
- Production startup or route initialization must fail closed if the secret is missing.
- The secret must be at least 32 bytes of entropy.

Token format:

```text
base64url(json_payload).base64url(hmac_sha256(payload, DRAFT_STATE_SECRET))
```

Payload shape:

```json
{
  "version": 1,
  "draftRunId": "uuid",
  "seed": "hex-string",
  "status": "drafting",
  "pickNumber": 4,
  "roster": {
    "C": ["card_id_1"],
    "W": ["card_id_2"],
    "D": [],
    "G": []
  },
  "selectedCardIds": ["card_id_1", "card_id_2"],
  "selectedPlayerIds": ["player_id_1", "player_id_2"],
  "shownCardIds": ["card_id_1", "card_id_2", "card_id_3"],
  "shownFranchiseKeys": ["PIT", "COL", "MTL"],
  "lifelines": {
    "same_team_shuffle": 1,
    "different_team_shuffle": 0,
    "same_team_choose_position": 1,
    "pick_two": 1,
    "reveal_ratings": 1
  },
  "currentFranchiseKey": "MTL",
  "currentBoardCardIds": ["card_id_10", "card_id_11"],
  "boardPicksRemaining": 1,
  "pickTwoActive": false,
  "revealedBoardRatings": false,
  "createdAt": "2026-06-07T00:00:00.000Z",
  "expiresAt": "2026-06-07T02:00:00.000Z",
  "nonce": 7
}
```

Notes:

- `currentBoardCardIds` must be signed because the server must verify the selected card was actually on the current board.
- `shownCardIds` and `shownFranchiseKeys` must be signed because board generation depends on them.
- `nonce` increments after every accepted action. This does not prevent replay by itself without storage, but it gives deterministic ordering inside the signed state and makes debugging easier.
- `expiresAt` limits how long a token can be reused.
- Token size must stay below `20 KB`.
- If the signed token grows near that limit, reduce payload fields before launch.

Performance rule:

- Store only IDs and compact primitive state in the token.
- Do not store full card objects in the token.
- Do not store full board card objects in the token.
- Do not store public display fields that can be rehydrated from server-side card data.

## Serverless API Contract

### `POST /api/draft/start`

Request:

```json
{}
```

Response:

```json
{
  "draftToken": "signed-token",
  "draft": {
    "draftRunId": "uuid",
    "status": "drafting",
    "pickNumber": 1,
    "currentFranchiseKey": "PIT",
    "board": [],
    "roster": {},
    "lifelines": {},
    "boardPicksRemaining": 1,
    "pickTwoActive": false,
    "revealedBoardRatings": false
  }
}
```

### `POST /api/draft/select`

Request:

```json
{
  "draftToken": "signed-token",
  "cardId": "selected-card-id"
}
```

Server responsibilities:

1. Verify token signature.
2. Verify token version.
3. Verify `expiresAt`.
4. Rehydrate internal engine state from signed payload.
5. Verify `cardId` is on `currentBoardCardIds`.
6. Verify player duplicate rule.
7. Verify roster fit.
8. Apply selection.
9. Generate next board or final result.
10. Return new signed token and public draft response.

### `POST /api/draft/lifeline`

Request:

```json
{
  "draftToken": "signed-token",
  "type": "same_team_choose_position",
  "position": "W"
}
```

Server responsibilities:

1. Verify token.
2. Verify lifeline exists.
3. Verify lifeline count is greater than `0`.
4. Apply lifeline.
5. Return new signed token and public draft response.

### `GET /api/health`

Response:

```json
{
  "ok": true,
  "cards": 3133,
  "teams": 32,
  "mode": "stateless"
}
```

Do not expose active draft count in stateless mode because there is no server-side draft map.

## Required Refactor Boundaries

### Keep

- `app/gameEngine.js` remains the canonical rules engine.
- Card loading remains server-side.
- Frontend remains simple and renders server responses.

### Change

- Remove `drafts = new Map()` from request flow.
- Add token signing/verification module.
- Add state serialization/deserialization module.
- Add deterministic random support only if needed for reproducibility/debugging.
- Add serverless route handlers.
- Add rate limiting middleware.
- Add prebuilt card JSON artifact for serverless loading.
- Add strict request validation.
- Add production security headers.

### Do Not Do Yet

- Do not add user accounts.
- Do not add payments.
- Do not add persistent draft history.
- Do not add database-backed leaderboards.
- Do not expose card scores before reveal.

## Deterministic Randomness

Serverless stateless mode does not strictly require full replay of every random event because the signed token stores `currentBoardCardIds`.

The signature is the integrity boundary. The server verifies the selected card against the signed current board, applies the action, generates the next board, and signs the next board IDs.

Deterministic randomness is still useful for debugging, repeatable tests, and future daily-challenge modes.

Current `crypto.randomInt` is fine for in-memory mode but not enough for stateless replay because the server must be able to rehydrate and continue the exact draft state from the token.

Add seeded RNG:

```js
createRng(seed, nonce)
```

Rules:

- `startDraft` creates a random `seed`.
- Every board generation uses the seed plus current `nonce`.
- Every accepted action increments `nonce`.
- Board results are signed in `currentBoardCardIds`.

Important:

Even with deterministic RNG, the server must validate against signed `currentBoardCardIds`.

We do not need to recompute previous boards from scratch on every request.

If deterministic RNG adds too much implementation complexity for MVP, defer seeded replay and rely on signed `currentBoardCardIds` for correctness.

## Card Data Loading

Do not parse CSV inside serverless request handlers.

Add a build step:

```text
data/team_board_pools_hockey_reference_enriched.csv
-> app/data/cards.generated.json
```

Recommended generated shape:

```json
{
  "generatedAt": "2026-06-07T00:00:00.000Z",
  "cardCount": 3133,
  "teamCount": 32,
  "cards": [],
  "teams": [],
  "byTeam": {
    "PIT": ["card_id_1", "card_id_2"]
  }
}
```

Runtime shape:

```js
{
  cards,
  cardById,
  byTeam,
  teams
}
```

Rules:

- `cards.generated.json` is committed or generated during build.
- API routes import/load the JSON once per serverless instance.
- API routes do not expose the full card pool to the client.
- Hidden values stay server-side unless selected or revealed.

Performance expectation:

- Full card pool is small enough for server memory.
- Per request only sends current public board, roster, result fields, and signed token.
- Client never downloads all 3,000+ cards.

## Stateless State Conversion

Add functions:

```js
stateToTokenPayload(state)
tokenPayloadToState(payload, cardById)
```

`stateToTokenPayload` stores card IDs only.

`tokenPayloadToState` rehydrates full card objects from `cardById`.

Validation:

- Every selected card ID must exist.
- Every board card ID must exist.
- Every roster card ID must appear in `selectedCardIds`.
- Every selected card's player ID must match `selectedPlayerIds`.
- Roster count must match `pickNumber - 1`, except when `pick_two` is active.
- Completed drafts should not allow more actions.

## Rate Limiting

Pure in-memory rate limiting does not work reliably on serverless because instances are ephemeral.

Use one of these:

Preferred:

- Vercel Firewall / WAF rate limiting with `@vercel/firewall`.

Fallback:

- Upstash Redis rate limiting when app-owned counters are needed.

Do not pretend local in-memory rate limits are production protection.

Production rule:

- If `NODE_ENV=production`, rate limiting must be enabled.
- If `RATE_LIMIT_PROVIDER=vercel`, Vercel WAF rules must be configured with matching rate-limit IDs.
- If `RATE_LIMIT_PROVIDER=upstash`, missing Upstash config must fail closed.
- If no production rate-limit provider is configured, API mutations must return an error instead of allowing unlimited traffic.

Vercel rate-limit IDs:

```text
draft-start
draft-select
draft-lifeline
draft-health
```

Optional env overrides:

```text
VERCEL_RATE_LIMIT_ID_START=...
VERCEL_RATE_LIMIT_ID_SELECT=...
VERCEL_RATE_LIMIT_ID_LIFELINE=...
VERCEL_RATE_LIMIT_ID_HEALTH=...
```

Vercel dashboard setup:

1. Open the Vercel project.
2. Go to Firewall.
3. Create a custom rule using the `@vercel/firewall` condition.
4. Use the matching rate-limit ID, such as `draft-start`.
5. Configure the window/count in the dashboard.
6. Publish the firewall changes.

If a Vercel rate-limit ID is missing in production, the API must fail closed.

Suggested limits:

```text
POST /api/draft/start       20 per hour per IP
POST /api/draft/select      120 per minute per IP
POST /api/draft/lifeline    60 per minute per IP
GET  /api/health            60 per minute per IP
```

Also add:

- Request body max: `32 KB`.
- Token max length: `20 KB`.
- Reject unknown JSON fields on action endpoints.
- Reject non-JSON requests for POST endpoints.
- Reject requests missing `Content-Type: application/json` on POST endpoints.

## Security Headers And Origin Policy

Add headers on every API response:

```text
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

For frontend/static responses, add a reasonable Content Security Policy:

```text
default-src 'self';
script-src 'self';
style-src 'self';
connect-src 'self';
img-src 'self' https:;
base-uri 'none';
frame-ancestors 'none';
```

Origin policy:

- `ALLOWED_ORIGIN` is required in production.
- Browser requests from other origins should be rejected for mutating API routes.
- CORS/origin checks are not the primary security boundary because non-browser clients can bypass them.
- Token signatures and server-side validation remain the real security boundary.

Cache policy:

- API responses are always `no-store`.
- Static assets can be cached with content-hash filenames later.
- Do not cache signed draft responses at CDN edge.

## Abuse Protection

### Token Security

Tests must prove:

- Modified token payload is rejected.
- Modified signature is rejected.
- Expired token is rejected.
- Missing token is rejected.
- Unknown token version is rejected.
- Token over `20 KB` is rejected.
- Production mode without `DRAFT_STATE_SECRET` fails closed.

### Game Integrity

Tests must prove:

- Client cannot select a card not on the current board.
- Client cannot select same player twice.
- Client cannot exceed roster limits.
- Client cannot use a lifeline twice.
- Client cannot reveal scores without using `reveal_ratings`.
- Client cannot submit final score manually.

### API Hardening

Tests must prove:

- Invalid JSON returns `400`.
- Oversized body returns `413`.
- Unsupported method returns `405`.
- Unknown route returns `404`.
- Rate-limited request returns `429`.
- Missing JSON content type returns `415` or `400`.
- Unknown request fields return `400`.
- API responses include required security headers.

## TDD Implementation Plan

### Phase 1: Lock Current Behavior Before Refactor

Write or update tests first:

1. `tests/test_game_engine.js`
   - Existing board, roster, compatibility, lifeline tests must continue passing.
   - Add final score response tests if missing.

2. `tests/test_server_api_memory.js`
   - Start draft returns playable board.
   - Select card advances draft.
   - Lifeline mutates board correctly.
   - Complete draft returns score and rings.

Acceptance:

```text
node --test tests/test_game_engine.js tests/test_server_api_memory.js
```

All tests pass before any stateless refactor.

### Phase 2: Add Token Module

Create:

```text
app/security/draftToken.js
```

Exports:

```js
signDraftPayload(payload, secret)
verifyDraftToken(token, secret, now)
```

Write tests:

```text
tests/test_draft_token.js
```

Test cases:

- Signs and verifies payload.
- Rejects token with changed payload.
- Rejects token with changed signature.
- Rejects malformed token.
- Rejects missing secret in production mode.
- Rejects weak production secret.
- Rejects expired payload.
- Rejects oversized token.
- Accepts valid non-expired payload.

Acceptance:

```text
node --test tests/test_draft_token.js
```

### Phase 3: Add State Serialization

Create:

```text
app/statelessDraftState.js
```

Exports:

```js
stateToTokenPayload(state)
tokenPayloadToState(payload, cardById)
validateTokenPayload(payload, cardById)
```

Write tests:

```text
tests/test_stateless_draft_state.js
```

Test cases:

- Converts active draft state to ID-only payload.
- Rehydrates selected cards from `cardById`.
- Rehydrates current board from `currentBoardCardIds`.
- Rejects missing selected card.
- Rejects missing board card.
- Rejects roster card not in selected cards.
- Preserves `shownCardIds`.
- Preserves `shownFranchiseKeys`.
- Preserves lifeline counts.

Acceptance:

```text
node --test tests/test_stateless_draft_state.js
```

### Phase 4: Add Deterministic RNG Support

This phase is useful but not required for stateless security.

If implementation speed matters, this phase can be reduced to deterministic test RNG injection only. Stateless correctness comes from signed `currentBoardCardIds`, not from replaying the full random history.

Refactor `app/gameEngine.js` to accept optional RNG.

New pattern:

```js
startDraft({ byTeam, teams, rng })
generateBoard({ byTeam, teams, state, rng })
selectCard({ state, cardId, byTeam, teams, rng })
useLifeline({ state, type, position, byTeam, teams, rng })
```

Default remains secure random for local mode.

Write tests:

```text
tests/test_deterministic_boards.js
```

Test cases:

- Same seed produces same first board.
- Different seed can produce different board.
- Same state plus same nonce produces same next board.
- No repeated team boards still applies.
- Same-team shuffle remains intentional exception.

Acceptance:

```text
node --test tests/test_deterministic_boards.js tests/test_game_engine.js
```

### Phase 5: Build Stateless API Handlers

Create:

```text
app/statelessApi.js
```

Exports handler functions independent of HTTP framework:

```js
startDraftAction({ store, secret, now })
selectCardAction({ store, secret, now, draftToken, cardId })
useLifelineAction({ store, secret, now, draftToken, type, position })
```

Write tests:

```text
tests/test_stateless_api.js
```

Test cases:

- Start returns `draftToken` and public draft.
- Select with valid token returns new token.
- Old token reuse is allowed but only replays from old state; it does not corrupt server state because none exists.
- Tampered token select fails.
- Selecting card not on board fails.
- Lifeline with valid token returns new token.
- Lifeline with exhausted count fails.
- Completed draft token rejects further select/lifeline.
- Board ratings are hidden unless selected or `reveal_ratings` has been used.
- API never accepts client-supplied score/rings fields.

Acceptance:

```text
node --test tests/test_stateless_api.js
```

### Phase 6: Add HTTP Layer

Create serverless-compatible route layer.

Recommended structure:

```text
api/draft/start.js
api/draft/select.js
api/draft/lifeline.js
api/health.js
```

Or, if using a single Node server locally:

```text
app/serverlessRoutes.js
```

HTTP tests should target route handlers without needing a live server.

Write tests:

```text
tests/test_stateless_http.js
```

Test cases:

- `POST /api/draft/start` works.
- `POST /api/draft/select` works.
- `POST /api/draft/lifeline` works.
- Invalid method returns `405`.
- Invalid JSON returns `400`.
- Oversized body returns `413`.
- Missing token returns `400`.
- Unknown fields return `400`.
- Missing JSON content type returns `415` or `400`.
- Security headers are present.

Acceptance:

```text
node --test tests/test_stateless_http.js
```

### Phase 7: Add Rate Limiting

Create:

```text
app/security/rateLimit.js
```

Exports:

```js
checkRateLimit({ key, route, now })
```

Implementation modes:

- `memory` for tests/local only.
- `upstash` for production.

Write tests:

```text
tests/test_rate_limit.js
```

Test cases:

- Allows requests under limit.
- Blocks requests over limit.
- Uses separate buckets per route.
- Uses separate buckets per IP.
- Resets after window.
- Production mode fails closed if rate-limit provider is missing.
- Production mode allows `RATE_LIMIT_PROVIDER=vercel` without Redis config.
- Vercel mode has stable default route IDs.
- Vercel route IDs can be overridden by env var.
- Production mode fails closed if Upstash config is incomplete.
- Local memory provider is rejected when `NODE_ENV=production`.

Acceptance:

```text
node --test tests/test_rate_limit.js
```

Production requirement:

```text
RATE_LIMIT_PROVIDER=vercel
```

Vercel WAF rules must be configured in the Vercel dashboard with these IDs:

```text
draft-start
draft-select
draft-lifeline
draft-health
```

Optional Upstash fallback:

```text
RATE_LIMIT_PROVIDER=upstash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Local requirement:

```text
RATE_LIMIT_PROVIDER=memory
```

### Phase 7.5: Add Generated Card Data Artifact

Create:

```text
scripts/build_serverless_card_data.js
app/data/cards.generated.json
```

Write tests:

```text
tests/test_serverless_card_data.js
```

Test cases:

- Generated JSON contains expected `cardCount`.
- Every `byTeam` card ID exists in `cards`.
- Every card has required fields.
- Hidden scoring fields exist server-side.
- Public API projection does not expose hidden scoring fields unless allowed.
- JSON load path does not parse CSV at request time.

Acceptance:

```text
node scripts/build_serverless_card_data.js
node --test tests/test_serverless_card_data.js
```

### Phase 8: Frontend Token Migration

Update:

```text
app/public/app.js
```

Frontend state:

```js
const state = {
  draft: null,
  draftToken: null,
  lastSelectedCard: null,
};
```

API changes:

- Store `draftToken` from every response.
- Send `draftToken` on select.
- Send `draftToken` on lifeline.
- Never send local roster or score state.

Write browser-free tests if practical:

```text
tests/test_frontend_payload_contract.js
```

Test cases:

- Select request body includes only `draftToken` and `cardId`.
- Lifeline request body includes only `draftToken`, `type`, and optional `position`.
- Frontend does not store full card pool.
- Frontend does not send score, rings, roster score, OPS, DPS, GPS, or board contents as action truth.

Acceptance:

Manual local browser verification:

- Start new game.
- Select a card.
- Use reveal ratings.
- Use pick 2.
- Complete draft.
- Refresh page starts a fresh game.

### Phase 9: Deployment Config

Add:

```text
vercel.json
```

Minimum:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

Environment variables:

```text
NODE_ENV=production
DRAFT_STATE_SECRET=...
RATE_LIMIT_PROVIDER=vercel
ALLOWED_ORIGIN=https://your-domain.example
```

Vercel WAF setup:

- Create `@vercel/firewall` rate-limit rules for `draft-start`, `draft-select`, `draft-lifeline`, and optionally `draft-health`.
- Suggested limits:
  - `draft-start`: 20 per hour per IP.
  - `draft-select`: 120 per minute per IP.
  - `draft-lifeline`: 60 per minute per IP.
  - `draft-health`: 60 per minute per IP.

Deployment tests:

- `/api/health` returns stateless mode.
- Start draft works from deployed frontend.
- Select works.
- Lifeline works.
- Tampered token fails.
- Rate limit can return `429`.
- API responses include `Cache-Control: no-store`.
- Serverless route can cold start and still process an existing signed token.

## Final Production Contract

The production API is acceptable when:

- No draft state is stored in process memory.
- Every mutating request requires a signed draft token.
- Token tampering is rejected.
- Expired tokens are rejected.
- Oversized tokens are rejected.
- Client cannot select hidden/off-board cards.
- Client cannot mutate score or rings.
- Rate limiting is active in production.
- Production rate limiting fails closed if misconfigured.
- Request body limits are active.
- CORS/origin policy is active.
- Security headers are active.
- Card data loads from prebuilt JSON, not request-time CSV parsing.
- Serverless cold starts do not break active games.

## Implementation Order Summary

1. Lock current behavior with tests.
2. Add signed token module.
3. Add stateless state serializer.
4. Add deterministic RNG support.
5. Add stateless action handlers.
6. Add serverless HTTP routes.
7. Add rate limiting.
8. Update frontend to carry `draftToken`.
9. Add deployment config.
10. Run local and deployed smoke tests.

## Main Risk

Replay cannot be fully prevented without server-side storage.

Example:

- A user can reuse an older valid token to branch a draft from an earlier point.

For this game, that is acceptable for MVP because:

- There is no money.
- There is no leaderboard.
- The final result is just that local game outcome.
- The user cannot forge better cards or scores without breaking the signature.

If we later add global leaderboards, accounts, daily challenges, prizes, or shared results, then we should add server-side draft result storage and replay protection.
