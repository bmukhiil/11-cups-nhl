# 11 Cups NHL

## What This Is

11 Cups NHL is a browser-based draft game built around a single benchmark: can you draft a 7-player roster strong enough to match Ken Dryden's six Stanley Cups? The repo includes the game UI, the draft/scoring engine, stateless API handling, and the data pipelines that build franchise boards from historical NHL data.

## What Works

- Start a new draft run from the browser UI
- Generate a 10-card franchise board for each pick
- Enforce roster constraints across `C`, `W`, `D`, and `G`
- Apply position-fit penalties and handedness chemistry bonuses
- Use wild-card mechanics to reshuffle or force position-specific picks
- Reveal a final score, ring count, and percentile once the roster is complete
- Build the underlying card pool and player assets from local data scripts

## How It's Built

- Browser client in plain HTML/CSS/JavaScript
- Draft and scoring logic in [app/gameEngine.js](./app/gameEngine.js)
- Stateless token-based draft flow in [app/statelessApi.js](./app/statelessApi.js)
- Rate limiting and draft-token signing under [app/security](./app/security)
- Historical card pool and asset generation from local scripts and JSON/CSV datasets

## Technical Notes

- The game is not a static quiz. Each board is assembled from historical player data with bucketed board composition rules so runs feel varied while still preserving roster-building tension.
- The public scoring model goes beyond raw player quality by adjusting for slot fit and small chemistry effects instead of treating the roster as seven independent picks.
- The API flow is designed to be stateless: draft state is signed and passed through tokens rather than depending on a long-lived server session.

## Proof of Work

- Browser game shell and draft UI in [app/public/index.html](./app/public/index.html) and [app/public/app.js](./app/public/app.js)
- Draft rules, lifelines, thresholds, and roster-fit logic in [app/gameEngine.js](./app/gameEngine.js)
- Stateless signed-draft handling in [app/statelessApi.js](./app/statelessApi.js)
- Historical player headshots and generated card data checked into the repo for the playable experience

## Run Locally

```bash
npm install
npm run build
npm run dev
```
