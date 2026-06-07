# NHL Draft Game Technical Plan

## Goal

Build the MVP hockey draft game using the current Hockey-Reference playable card surface.

The game should let a user draft a 7-player roster from random franchise boards, reveal card values after selection, calculate a final score, and map that score to rings using the precomputed smart-picker percentile thresholds.

## Data Inputs

### Playable Cards

Use:

```text
data/team_board_pools_hockey_reference_raw.csv
```

Required fields:

```text
card_id
player_id
player_name
position
position_group
franchise_key
historical_team
team_name
franchise_name
current_team
card_type
card_label
selected_seasons
games_played_total
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
board_pool_rank
```

### Ring Thresholds

Use:

```text
data/draft_percentile_thresholds_hockey_reference.csv
```

Required fields:

```text
percentile
score
rings
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

## MVP Exclusions

Do not implement salary cap.

Do not implement headshots for MVP.

Do not show raw score or OPS/DPS/GPS before a card is selected.

Do not make draft boards roster-need aware.

## Roster Contract

The roster has exactly 7 slots:

```text
2 C
2 W
2 D
1 G
```

Recommended state shape:

```js
const roster = {
  C: [],
  W: [],
  D: [],
  G: [],
};
```

Slot limits:

```js
const ROSTER_LIMITS = {
  C: 2,
  W: 2,
  D: 2,
  G: 1,
};
```

Position mapping:

```text
G -> G
D -> D
C -> C
LW/RW/L/R/W/F -> W
```

## Game State Contract

Recommended top-level state:

```js
const gameState = {
  status: "drafting", // drafting | complete
  pickNumber: 1,
  roster,
  selectedPlayerIds: new Set(),
  currentTeam: null,
  currentBoard: [],
  revealedCardIds: new Set(),
  lifelines: {
    sameTeamShuffle: 1,
    differentTeamShuffle: 1,
    sameTeamChoosePosition: 1,
  },
  usedBoards: [],
  finalScore: null,
  percentile: null,
  rings: null,
};
```

## Draft Board Rules

Each pick starts by choosing a random current franchise key from the available team pools.

Board size:

```text
10 cards
```

Board generation:

1. Choose a random franchise.
2. Pull 10 random cards from that franchise pool.
3. Do not pre-filter by roster need.
4. Do not show hidden values before selection.
5. Mark invalid cards as disabled if they cannot fit an open roster slot.
6. Mark duplicate-player cards as disabled if `player_id` is already on the roster.

If a random board has no selectable cards, reroll internally until at least one selectable card exists.

## Card Selection Rules

When the user selects a valid card:

1. Add the card to the proper roster slot.
2. Add `player_id` to `selectedPlayerIds`.
3. Reveal the selected card's hidden values.
4. Advance to the next pick.
5. Generate the next random board.

Duplicate players are blocked within a single draft, even if the duplicate card is a different season or team.

## Visible Card Fields Before Selection

Show:

```text
player_name
franchise_key
position
card_type
card_label
```

Do not show:

```text
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
final score contribution
```

## Revealed Card Fields After Selection

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

The selected-card reveal should happen immediately after selection and remain visible in the roster.

## Lifeline Rules

Each lifeline can be used once per game.

```text
sameTeamShuffle: 1
differentTeamShuffle: 1
sameTeamChoosePosition: 1
```

### Same Team Shuffle

Use current `franchise_key`.

Generate a new random board of 10 cards from the same franchise.

### Different Team Shuffle

Choose a new random franchise.

Generate a new random board of 10 cards.

### Same Team Choose Position

Keep current `franchise_key`.

User chooses one open position group:

```text
C
W
D
G
```

Generate a new random board of 10 cards from the current franchise filtered to cards that can fill that chosen position.

If not enough cards exist, use all eligible cards for that team/position.

## Final Score

When all 7 roster slots are filled:

```js
finalScore = selectedCards.reduce((sum, card) => sum + Number(card.raw_card_ps), 0);
```

No salary cap modifier.

No chemistry modifier.

No position bonus in MVP.

## Percentile And Rings

Use the generated smart-picker threshold file.

For MVP, ring mapping can use the threshold score cutoffs directly:

```js
function ringsForScore(score) {
  if (score >= 95.299) return 6;
  if (score >= 90.653) return 5;
  if (score >= 87.262) return 4;
  if (score >= 84.539) return 3;
  if (score >= 82.412) return 2;
  if (score >= 79.681) return 1;
  return 0;
}
```

Percentile should be derived from the threshold curve or a fuller simulation distribution if we decide to persist one later.

For MVP display:

```text
Final Score
Estimated Percentile Band
Rings Won
```

## Smart-Picker Simulation Context

The thresholds are generated by:

```text
scripts/simulate_hockey_reference_draft_percentiles.js
```

Simulation rules:

- 50,000 drafts.
- Board size 10.
- Same roster format.
- Random team boards.
- Bot sees true `raw_card_ps`.
- Bot picks best valid card.
- Duplicate players blocked.

This simulation defines the baseline for rings.

## Recommended Modules

### Data Loader

Responsibilities:

- Load card CSV.
- Parse numeric fields.
- Group cards by `franchise_key`.
- Load threshold CSV.
- Expose team list.

### Game Engine

Responsibilities:

- Initialize game state.
- Generate random boards.
- Validate card selection.
- Apply selections.
- Apply lifelines.
- Detect game completion.
- Calculate final score.
- Calculate rings.

### UI Layer

Responsibilities:

- Display draft board.
- Hide card values before selection.
- Disable invalid cards.
- Display roster slots.
- Display lifeline buttons and remaining counts.
- Reveal selected-card values.
- Display final result.

### Simulation Utilities

Responsibilities:

- Keep smart-picker logic separate from user-facing game logic.
- Regenerate thresholds when card data changes.

## Test Plan

### Data Tests

- Card CSV loads successfully.
- Every card has `card_id`, `player_id`, `position`, `franchise_key`, `raw_card_ps`.
- Every card maps to a valid roster slot.
- Threshold CSV loads successfully.

### Board Tests

- Random board returns 10 cards when enough cards exist.
- Board is from one franchise.
- Board is not pre-filtered by roster needs.
- Invalid cards are identifiable.
- Board regeneration avoids zero-selectable boards.

### Selection Tests

- Selecting C fills a C slot.
- Selecting W fills a W slot.
- Selecting D fills a D slot.
- Selecting G fills the G slot.
- Duplicate `player_id` cannot be selected twice.
- Cards that do not fit open slots cannot be selected.

### Lifeline Tests

- Same-team shuffle keeps franchise.
- Different-team shuffle changes franchise where possible.
- Same-team choose-position filters by selected open position.
- Each lifeline decrements from 1 to 0.
- Used lifeline cannot be reused.

### Scoring Tests

- Final score equals sum of selected `raw_card_ps`.
- Game completes after 7 valid selections.
- Rings map correctly at threshold boundaries.

### Visibility Tests

- Draft board hides `raw_card_ps`, `raw_card_ops`, `raw_card_dps`, `raw_card_gps`.
- Selected cards reveal hidden fields.
- Final roster reveals all selected-card values.

## Build Order

1. Implement card/threshold data loader.
2. Implement pure game engine functions.
3. Add unit tests for game engine.
4. Build draft board UI.
5. Build roster UI.
6. Build lifeline controls.
7. Build post-selection reveal behavior.
8. Build final result screen.
9. Verify with fixed random seed game runs.
10. Run manual playtests and tune only after MVP is working.
