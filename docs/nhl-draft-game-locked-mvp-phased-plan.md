# NHL Draft Game Locked MVP Phased Plan

## Objective

Build a deployable hockey draft web game where a user drafts a 7-player roster from random NHL franchise boards, then receives a final score, percentile band, and rings outcome.

The MVP is not a static CSV-in-browser prototype. The MVP is a real web app with API endpoints backed by a database.

## Locked Architecture

Use a single deployable product stack:

```text
Frontend: Next.js
Backend API: FastAPI
Database: Postgres
Hosting: Vercel
Database hosting: Neon or Supabase
```

FastAPI can be deployed on Vercel using Vercel's Python runtime. We do not need Cloudflare Workers for MVP.

The API is serverless. It should handle normal request/response game actions only.

Long-running work stays offline:

- Hockey-Reference scraping.
- Headshot downloading.
- Card generation.
- Draft percentile simulations.
- CSV-to-database imports.

## Monorepo Shape

Recommended repo structure:

```text
/
  app/ or web/
    Next.js frontend

  api/
    index.py
    routes/
    services/
    db/

  data/
    team_board_pools_hockey_reference_raw.csv
    draft_percentile_thresholds_hockey_reference.csv
    hockey_reference_player_seasons_clean.csv
    hockey_reference_card_windows.csv

  scripts/
    build_hockey_reference_point_shares.js
    simulate_hockey_reference_draft_percentiles.js
    import_cards_to_db.py
    import_thresholds_to_db.py

  docs/
```

CSV files remain build artifacts and audit artifacts.

Runtime data comes from Postgres through FastAPI endpoints.

## MVP Product Rules

### Game Goal

The user drafts a team and tries to win 6 rings.

Rings are determined by score percentile against the deterministic smart-picker simulation baseline.

### Roster

The final roster has exactly 7 players:

```text
2 C
2 W
2 D
1 G
```

### Draft Length

The draft has 7 selections.

Each selection fills one roster slot.

### Draft Board

Each pick shows:

```text
10 cards
```

Draft boards are purely random.

They are not roster-need aware.

The board is generated from one random current NHL franchise pool.

Cards that cannot fit an open roster slot are disabled.

Duplicate players are disabled if that `player_id` is already on the roster.

If a generated board has no selectable cards, the server rerolls internally.

### Lifelines

Each lifeline item can be used once per draft:

```text
same_team_shuffle: 1
different_team_shuffle: 1
same_team_choose_position: 1
```

Total lifeline uses available:

```text
3
```

#### Same Team Shuffle

Regenerate a 10-card board from the same franchise.

#### Different Team Shuffle

Choose a new random franchise and generate a 10-card board.

#### Same Team Choose Position

Keep the current franchise.

User chooses one open position:

```text
C
W
D
G
```

Generate a board from the same franchise filtered to that selected position.

### Salary Cap

No salary cap in MVP.

### Headshots

Ignore headshots for MVP.

The data pipeline can download them later, but the MVP should not depend on them.

## Card Data Rules

Cards come from Hockey-Reference Point Shares.

Current generated game surface:

```text
data/team_board_pools_hockey_reference_raw.csv
```

### Card Versions

Cards represent:

```text
early
peak
late
```

Current rules:

- `peak`: best eligible single season with the gameplay franchise.
- `early`: early-career/arrival season.
- If early duplicates peak, early falls back to the first eligible franchise season.
- `late`: late-career season, preferring a season distinct from early and peak.

### Eligibility

```text
Skaters: games_played >= 65
Goalies: games_played >= 40
```

### Duplication Limits

```text
max_cards_per_player_franchise = 3
max_cards_per_player_total = 4
```

### Franchise Mapping

Historical teams map into current gameplay franchises.

Examples:

```text
QUE -> COL
HFD -> CAR
MNS -> DAL
Seals/Barons -> DAL
ARI/PHX/WIN -> UTA
```

## Hidden And Revealed Card Information

### Before Selection

The user can see:

```text
player_name
franchise_key
position
card_type
card_label
```

The user cannot see:

```text
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
score contribution
```

### After Selection

After selecting a card, reveal the true card values.

For skaters:

```text
Total impact: raw_card_ps
Offensive impact: raw_card_ops
Defensive impact: raw_card_dps
```

For goalies:

```text
Total impact: raw_card_ps
Goalie impact: raw_card_gps
```

At the final result screen, show every selected card's revealed values and the team total.

## Scoring

Final score:

```text
team_score = sum(selected_card.raw_card_ps)
```

No salary modifier.

No chemistry modifier.

No position bonus.

## Rings And Percentiles

Rings are derived from a precomputed deterministic smart-picker simulation.

Simulation source:

```text
data/draft_percentile_thresholds_hockey_reference.csv
```

Simulation script:

```text
scripts/simulate_hockey_reference_draft_percentiles.js
```

Simulation settings:

```text
50,000 drafts
10-card boards
2 C / 2 W / 2 D / 1 G roster
random franchise boards
bot sees true raw_card_ps
bot picks highest-value valid card
duplicate players blocked
```

Current ring thresholds:

```text
1 ring: 79.681
2 rings: 82.412
3 rings: 84.539
4 rings: 87.262
5 rings: 90.653
6 rings: 95.299
```

MVP ring function:

```python
def rings_for_score(score: float) -> int:
    if score >= 95.299:
        return 6
    if score >= 90.653:
        return 5
    if score >= 87.262:
        return 4
    if score >= 84.539:
        return 3
    if score >= 82.412:
        return 2
    if score >= 79.681:
        return 1
    return 0
```

## Database Scope

Use Postgres as the runtime source of truth.

### Required Tables

#### cards

Stores playable card surface.

Required columns:

```text
id
card_id
player_id
player_name
position
position_group
franchise_key
historical_team
team_name
franchise_name
card_type
card_label
selected_seasons
games_played_total
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
board_pool_rank
created_at
```

Indexes:

```text
unique(card_id)
index(franchise_key)
index(player_id)
index(position)
index(position_group)
```

#### ring_thresholds

Stores simulation thresholds.

Required columns:

```text
id
percentile
score
rings
simulation_version
created_at
```

#### draft_runs

Stores draft sessions.

Required columns:

```text
id
seed
status
pick_number
current_franchise_key
final_score
percentile_band
rings
created_at
completed_at
```

#### draft_picks

Stores selected picks.

Required columns:

```text
id
draft_run_id
pick_number
card_id
franchise_key
created_at
```

#### draft_lifelines

Stores lifeline usage.

Required columns:

```text
id
draft_run_id
lifeline_type
used
used_at
```

## API Scope

The API owns random board generation, hidden/reveal behavior, validation, and final scoring.

### GET /api/health

Returns service health.

### GET /api/franchises

Returns available franchises and card counts.

Response:

```json
[
  {
    "franchiseKey": "BOS",
    "cardCount": 100
  }
]
```

### POST /api/draft/start

Creates a draft run.

Returns:

```json
{
  "draftRunId": "uuid",
  "pickNumber": 1,
  "roster": {
    "C": [],
    "W": [],
    "D": [],
    "G": []
  },
  "lifelines": {
    "sameTeamShuffle": 1,
    "differentTeamShuffle": 1,
    "sameTeamChoosePosition": 1
  },
  "board": []
}
```

The returned board should hide card scores.

### POST /api/draft/{draft_run_id}/board

Generates or returns the current board.

Request options:

```json
{
  "mode": "normal"
}
```

Response board card shape:

```json
{
  "cardId": "string",
  "playerId": "string",
  "playerName": "string",
  "franchiseKey": "BOS",
  "position": "C",
  "positionGroup": "F",
  "cardType": "peak",
  "cardLabel": "2009-10",
  "selectable": true,
  "disabledReason": null
}
```

Do not include raw values in board responses.

### POST /api/draft/{draft_run_id}/select

Selects a card.

Request:

```json
{
  "cardId": "string"
}
```

Server validates:

- Draft exists.
- Draft is not complete.
- Card is on the current board.
- Card fits an open roster slot.
- Player is not already selected.

Response reveals selected card values:

```json
{
  "selectedCard": {
    "cardId": "string",
    "playerId": "string",
    "playerName": "string",
    "position": "C",
    "franchiseKey": "PIT",
    "cardType": "peak",
    "cardLabel": "2009-10",
    "rawCardPs": 14.669,
    "rawCardOps": 12.226,
    "rawCardDps": 2.443,
    "rawCardGps": null
  },
  "pickNumber": 2,
  "roster": {},
  "status": "drafting"
}
```

If the draft is complete, return final result too.

### POST /api/draft/{draft_run_id}/lifeline

Uses one lifeline.

Request:

```json
{
  "type": "same_team_shuffle",
  "position": null
}
```

Allowed types:

```text
same_team_shuffle
different_team_shuffle
same_team_choose_position
```

For `same_team_choose_position`, `position` is required.

Response:

```json
{
  "lifelines": {},
  "board": []
}
```

Board response still hides card scores.

### GET /api/draft/{draft_run_id}

Returns current draft state.

Selected cards include revealed values.

Unselected board cards do not include hidden values.

### POST /api/draft/{draft_run_id}/complete

Completes draft if roster is full.

Calculates:

```text
final_score
rings
percentile_band
```

Returns final roster and result.

## Frontend Scope

Build a mobile-first web app.

### Main Screens

#### Draft Screen

Shows:

- Pick progress.
- Current franchise board.
- 10 hidden-value cards.
- Roster slots.
- Lifeline controls.

Mobile layout:

```text
Top: pick progress / current franchise
Middle: draft board
Bottom sticky: roster summary + lifelines
```

Desktop layout:

```text
Left/main: draft board
Right: roster + lifelines
```

#### Selection Reveal

After selecting a card, show the selected card's true values.

This can be:

- inline in roster
- temporary reveal drawer
- small modal

#### Final Result Screen

Shows:

- Final roster.
- Each selected card's revealed values.
- Total score.
- Ring count.
- Percentile band.

## Phased Build Plan

## Phase 1: Project Scaffold

Deliverables:

- Next.js frontend app.
- FastAPI API folder.
- Shared environment setup.
- Local dev commands.
- Basic Vercel-compatible structure.

Acceptance criteria:

- Frontend runs locally.
- FastAPI health endpoint runs locally.
- Project can be deployed to Vercel without database logic yet.

## Phase 2: Database And Imports

Deliverables:

- Postgres schema.
- Migration scripts.
- CSV import scripts for cards and thresholds.
- Seed/import command documentation.

Acceptance criteria:

- `cards` table populated from `team_board_pools_hockey_reference_raw.csv`.
- `ring_thresholds` table populated from `draft_percentile_thresholds_hockey_reference.csv`.
- API can query card counts by franchise.

## Phase 3: API Game Engine

Deliverables:

- Roster validation.
- Position normalization.
- Random board generation.
- Hidden board card response shape.
- Selection validation.
- Revealed selected-card response.
- Lifeline usage logic.
- Final scoring and rings logic.

Acceptance criteria:

- Start draft endpoint works.
- Board endpoint returns 10 hidden cards.
- Select endpoint reveals only selected card values.
- Lifelines decrement and cannot be reused.
- Draft completes after 7 valid selections.
- Final score equals selected `raw_card_ps` sum.

## Phase 4: Mobile-First Frontend

Deliverables:

- Draft screen.
- Draft card components.
- Disabled-card states.
- Roster component.
- Lifeline controls.
- Post-selection reveal.
- Final result screen.

Acceptance criteria:

- Works on mobile viewport.
- Works on desktop viewport.
- User can complete full draft.
- Hidden values are not visible before selection.
- Revealed values are shown after selection.

## Phase 5: QA And Tuning

Deliverables:

- API tests for game rules.
- Frontend smoke tests.
- Manual draft test checklist.
- Threshold verification.

Acceptance criteria:

- Duplicate players cannot be selected.
- Invalid positions cannot be selected.
- Lifelines work exactly once.
- Random boards are not roster-need aware.
- Final rings match threshold file.

## Phase 6: Deploy MVP

Deliverables:

- Vercel deployment.
- Postgres production database.
- Environment variables configured.
- Data imported into production.
- Public MVP URL.

Acceptance criteria:

- App is playable on production URL.
- API reads from production Postgres.
- Draft can be completed end to end.
- Final result appears correctly.

## Non-MVP Backlog

Do not build these in MVP:

- Salary cap.
- Headshots.
- User accounts.
- Leaderboards.
- Daily challenge.
- Share cards/results.
- Advanced rating curve.
- Era-normalized ratings.
- Admin dashboard.
- Analytics.
- Separate long-running worker service.

## MVP Definition Of Done

The MVP is done when:

1. A user can open the web app on mobile.
2. Start a new draft.
3. Draft 7 valid players from random franchise boards.
4. Use each lifeline once.
5. See hidden values only after selection.
6. Complete the roster.
7. See final score.
8. See percentile/ring outcome.
9. The app is deployed.
10. Runtime card data comes from Postgres through FastAPI.
