# NHL Data Pipeline Implementation Plan

## Purpose

Turn the product/spec documents into a concrete implementation plan for generating the first NHL game data artifacts.

Source specs:

```text
docs/nhl-data-cleaning-plan.md
docs/nhl-rating-salary-points-plan.md
```

This document is the build plan for an agent or developer.

It defines:

```text
scripts to create
inputs
outputs
contract boundaries
processing order
validation rules
unit test plan
```

## Implementation Goal

Build a small Python-based data pipeline that can generate:

```text
data/clean_player_seasons.csv
data/league_season_context.csv
data/player_season_zscores.csv
data/player_season_scores.csv
data/player_game_values.csv
```

from the NHL Stats API.

No UI, draft pool generation, team-era grouping, salary simulation, or manual curation is included in this implementation phase.

## Recommended Project Structure

Create this structure:

```text
data/
  clean_player_seasons.csv
  league_season_context.csv
  player_season_zscores.csv
  player_season_scores.csv
  player_game_values.csv

scripts/
  build_clean_player_seasons.py
  build_player_game_values.py

tests/
  test_clean_player_seasons.py
  test_player_game_values.py
```

Optional later:

```text
data/raw/
data/cache/
```

Do not add raw/cache folders unless needed during implementation.

## Runtime Choice

Use Python.

Recommended dependencies:

```text
requests
pandas
pytest
```

Keep the implementation lightweight.

Do not introduce a database for version 1.

Do not introduce a web framework.

Do not introduce a notebook as the primary pipeline.

## Contract Boundary 1: NHL API to Clean CSV

Script:

```text
scripts/build_clean_player_seasons.py
```

Input:

```text
NHL Stats API
```

Outputs:

```text
data/clean_player_seasons.csv
```

This script is responsible for:

```text
calling NHL API endpoints
handling pagination
normalizing skater rows
normalizing goalie rows
joining skater summary with skater realtime
dropping invalid rows
writing the clean CSV
```

This script is not responsible for:

```text
league context
z-scores
ratings
salaries
game points
team pools
era grouping
```

## Contract Boundary 2: Clean CSV to Game Values

Script:

```text
scripts/build_player_game_values.py
```

Input:

```text
data/clean_player_seasons.csv
```

Outputs:

```text
data/league_season_context.csv
data/player_season_zscores.csv
data/player_season_scores.csv
data/player_game_values.csv
```

This script is responsible for:

```text
calculating league season context
calculating z-scores
calculating player season scores
applying reliability adjustment
converting scores into ratings
calculating salary
calculating game points
writing output CSVs
```

This script is not responsible for:

```text
calling the NHL API
cleaning raw API fields
dropping multi-team seasons
dropping low-games seasons
selecting final game seasons
draft simulation
```

## CLI Contract

The scripts should be runnable from the repository root.

Clean data script:

```bash
python scripts/build_clean_player_seasons.py --start-season 19171918 --end-season 20252026
```

Scoring script:

```bash
python scripts/build_player_game_values.py --input data/clean_player_seasons.csv
```

Both scripts should fail loudly if required inputs are missing.

Both scripts should create the `data/` directory if it does not exist.

## NHL API Endpoints

Base URL:

```text
https://api.nhle.com/stats/rest/en
```

Skater summary:

```text
/skater/summary
```

Skater realtime:

```text
/skater/realtime
```

Goalie summary:

```text
/goalie/summary
```

Required query options:

```text
isAggregate=false
isGame=false
gameTypeId=2
seasonId={season_id}
```

Pagination:

```text
Try limit=-1 first.
If unsupported, use limit=1000 and increment start until collected rows >= total.
```

## Season ID Generation

Generate season IDs from start and end inclusive.

Example:

```text
19171918
19181919
19191920
...
20252026
```

Implementation rule:

```python
season_id = int(f"{start_year}{start_year + 1}")
```

For:

```text
--start-season 19171918
--end-season 20252026
```

iterate start years:

```text
1917 through 2025
```

## Clean CSV Contract

Output file:

```text
data/clean_player_seasons.csv
```

Required columns, in this exact order:

```text
player_id
player_name
season_id
season_label
team
position
position_group
player_type
games_played
goals
assists
points
plus_minus
shots
shooting_pct
time_on_ice_per_game
faceoff_win_pct
penalty_minutes
power_play_goals
power_play_points
short_handed_goals
short_handed_points
game_winning_goals
overtime_goals
hits
blocked_shots
wins
losses
ties
overtime_losses
save_percentage
goals_against_average
shutouts
goals_against
shots_against
saves
source
```

Clean row rules:

```text
regular season only
single-team season only
games_played >= 40
valid player_id
valid player_name
valid season_id
valid team
```

Drop row if:

```text
teamAbbrevs is null
teamAbbrevs is blank
teamAbbrevs contains comma
gamesPlayed < 40
playerId is missing
player name is missing
seasonId is missing
```

No dropped-row output is required.

## Skater Normalization

Map skater summary fields:

```text
player_id              <- playerId
player_name            <- skaterFullName
season_id              <- seasonId
season_label           <- derived
team                   <- teamAbbrevs
position               <- positionCode
position_group         <- derived
player_type            <- "skater"
games_played           <- gamesPlayed
goals                  <- goals
assists                <- assists
points                 <- points
plus_minus             <- plusMinus
shots                  <- shots
shooting_pct           <- shootingPct
time_on_ice_per_game   <- timeOnIcePerGame
faceoff_win_pct        <- faceoffWinPct
penalty_minutes        <- penaltyMinutes
power_play_goals       <- ppGoals
power_play_points      <- ppPoints
short_handed_goals     <- shGoals
short_handed_points    <- shPoints
game_winning_goals     <- gameWinningGoals
overtime_goals         <- otGoals
source                 <- "nhl_stats_api"
```

Join skater realtime fields by:

```text
playerId
seasonId
teamAbbrevs
```

Map:

```text
hits                   <- hits
blocked_shots          <- blockedShots
```

If no realtime match exists:

```text
hits = blank
blocked_shots = blank
```

Do not synthesize historical hits or blocked shots.

Goalie-specific columns should be blank on skater rows.

## Goalie Normalization

Map goalie summary fields:

```text
player_id              <- playerId
player_name            <- goalieFullName
season_id              <- seasonId
season_label           <- derived
team                   <- teamAbbrevs
position               <- "G"
position_group         <- "G"
player_type            <- "goalie"
games_played           <- gamesPlayed
wins                   <- wins
losses                 <- losses
ties                   <- ties
overtime_losses        <- otLosses
save_percentage        <- savePct
goals_against_average  <- goalsAgainstAverage
shutouts               <- shutouts
goals_against          <- goalsAgainst
shots_against          <- shotsAgainst
saves                  <- saves
source                 <- "nhl_stats_api"
```

Skater-specific columns should be blank on goalie rows.

## Derived Helpers

Season label:

```python
def season_label(season_id):
    raw = str(season_id)
    return f"{raw[:4]}-{raw[6:]}"
```

Example:

```text
20242025 -> 2024-25
```

Position group:

```text
C  -> F
L  -> F
R  -> F
LW -> F
RW -> F
D  -> D
G  -> G
```

Rating group:

```text
position_group F -> forwards
position_group D -> defensemen
position_group G -> goalies
```

## Scoring Pipeline

Input:

```text
data/clean_player_seasons.csv
```

Step order:

```text
1. Load clean_player_seasons.csv
2. Validate required columns
3. Calculate league season context
4. Calculate z-scores
5. Calculate player season scores
6. Apply reliability adjustment
7. Assign rating groups
8. Convert adjusted scores to ratings
9. Drop the bottom 50% within each rating group from final game values
10. Calculate top-half mean/std by rating group
11. Convert top-half adjusted scores to game-score z-scores
12. Map game-score z-scores to 0-100 ratings
13. Calculate salaries
14. Calculate game points
13. Write all scoring CSVs
```

## League Context Output Contract

Output:

```text
data/league_season_context.csv
```

Columns:

```text
season_id
player_type
stat_name
mean
std
eligible_player_count
```

Calculate from:

```text
data/clean_player_seasons.csv
```

Do not calculate version 1 league context from raw API rows.

## Z-Score Output Contract

Output:

```text
data/player_season_zscores.csv
```

Columns:

```text
player_id
player_name
season_id
season_label
team
position
position_group
player_type
games_played
goals_z
assists_z
points_z
plus_minus_z
shots_z
time_on_ice_per_game_z
power_play_points_z
short_handed_points_z
game_winning_goals_z
hits_z
blocked_shots_z
wins_z
save_percentage_z
goals_against_average_z
shutouts_z
shots_against_z
saves_z
```

Z-score rule:

```python
z_score = (player_value - season_mean) / season_std
```

If player value is blank:

```python
z_score = 0
```

If season standard deviation is blank or zero:

```python
z_score = 0
```

Goalie GAA rule:

```python
goals_against_average_z = -1 * ((gaa - season_mean_gaa) / season_std_gaa)
```

## Player Season Score Output Contract

Output:

```text
data/player_season_scores.csv
```

Columns:

```text
player_id
player_name
season_id
season_label
team
position
position_group
player_type
games_played
season_score
adjusted_season_score
offense_score
defense_context_score
goalie_score
```

Forward formula:

```python
forward_score = (
    0.30 * goals_z
    + 0.30 * assists_z
    + 0.16 * points_z
    + 0.09 * plus_minus_z
    + 0.10 * shots_z
    + 0.05 * power_play_points_z
)
```

Defenseman formula:

```python
defense_score = (
    0.15 * goals_z
    + 0.25 * assists_z
    + 0.17 * points_z
    + 0.13 * plus_minus_z
    + 0.15 * time_on_ice_per_game_z
    + 0.15 * shots_z
)
```

Hits and blocked shots remain in the clean and z-score datasets, but are excluded from scoring because they are not consistently available across historical seasons.

Goalie formula:

```python
goalie_score = (
    0.35 * save_percentage_z
    + 0.20 * wins_z
    + 0.20 * goals_against_average_z
    + 0.15 * shutouts_z
    + 0.10 * saves_z
)
```

Reliability:

```python
if player_type == "goalie":
    reliability = min(1.0, games_played / 40)
else:
    reliability = min(1.0, games_played / 65)

adjusted_season_score = season_score * reliability
```

## Player Game Values Output Contract

Output:

```text
data/player_game_values.csv
```

Columns:

```text
player_id
player_name
season_id
season_label
team
position
position_group
player_type
games_played
season_score
adjusted_season_score
rating_group
rating
salary
game_points
source
```

Rating groups:

```text
F -> forwards
D -> defensemen
G -> goalies
```

Rating conversion:

```text
Calculate within each rating group.
Winsorize adjusted_season_score at 0.1 and 99.9 percentiles.
Rank winsorized scores ascending.
Convert rank to percentile.
Drop rows below the 50th percentile.
Calculate the mean and standard deviation of adjusted_season_score for the remaining top half.
Convert each remaining row to a game-score z-score.
Map game-score z-score to a 0-100 rating using fixed anchors.
```

Top-half filter:

```python
if percentile_rank < 0.5:
    exclude from player_game_values.csv
```

Game-score z-score:

```python
game_score_z = (adjusted_season_score - top_half_mean) / top_half_std
```

Rating anchors:

```text
-2.00 -> 0
-1.00 -> 25
 0.00 -> 50
 1.00 -> 74
 2.00 -> 86
 2.75 -> 94
 3.50 -> 98
 4.25 -> 100
```

Clamp to 0-100.

Salary:

```python
salary = round(5 + 30 * (rating / 100) ** 3)
```

Game points:

```python
game_points = round(rating)
```

## Implementation Validation Rules

After generating `clean_player_seasons.csv`, validate:

```text
No row has games_played < 40.
No row has blank player_id.
No row has blank player_name.
No row has blank season_id.
No row has blank team.
No row has a comma in team.
Every row has player_type of skater or goalie.
Every row has position_group of F, D, or G.
CSV columns exactly match the contract.
```

After generating scoring outputs, validate:

```text
player_game_values.csv contains only the top 50% of each rating group.
Ratings are between 0 and 100.
Salaries are positive integers.
Game points are non-negative integers.
Every row has rating_group.
No required output column is missing.
```

## Lightweight Unit Test Plan

Use `pytest`.

Do not require live NHL API access for unit tests.

Use small in-memory fixtures.

### Cleaning Tests

File:

```text
tests/test_clean_player_seasons.py
```

Test cases:

```text
season_label converts 20242025 to 2024-25
position_group maps C/L/R/LW/RW to F
position_group maps D to D
position_group maps G to G
single-team skater row is kept
multi-team skater row is dropped
row under 40 games is dropped
row with missing player_id is dropped
skater summary joins realtime hits and blocks
skater row gets blank goalie fields
goalie row maps savePct to save_percentage
goalie row gets blank skater fields
```

### Scoring Tests

File:

```text
tests/test_player_game_values.py
```

Test cases:

```text
z-score returns 0 when std is 0
z-score returns 0 when player value is blank
goalie GAA z-score is inverted
forward formula uses the expected weights
defenseman formula uses the expected weights
goalie formula uses the expected weights
skater reliability reaches 1.0 at 65 games
goalie reliability reaches 1.0 at 40 games
rating z-score interpolation maps -2 to 0
rating z-score interpolation maps 0 to 50
rating z-score interpolation maps 3.5 to 100
salary formula maps 100 rating to 35
game_points equals rounded rating
```

### Output Contract Tests

Test cases:

```text
clean CSV columns match exact expected order
player_game_values CSV columns match exact expected order
ratings are clamped between 0 and 100
all generated rows have source
```

## Suggested Implementation Order

Implement in this order:

```text
1. Create shared helper functions for season labels and position groups.
2. Implement pure row-normalization functions for skaters and goalies.
3. Write cleaning unit tests using fixtures.
4. Implement NHL API fetching and pagination.
5. Generate clean_player_seasons.csv for one modern season.
6. Validate the clean CSV contract.
7. Implement league context and z-score functions.
8. Implement scoring formulas and reliability.
9. Implement rating, salary, and game point functions.
10. Write scoring unit tests.
11. Generate all artifacts for one modern season.
12. Expand to full season range.
```

## Done Definition

This implementation phase is done when:

```text
python scripts/build_clean_player_seasons.py --start-season 19171918 --end-season 20252026
```

generates:

```text
data/clean_player_seasons.csv
```

and:

```text
python scripts/build_player_game_values.py --input data/clean_player_seasons.csv
```

generates:

```text
data/league_season_context.csv
data/player_season_zscores.csv
data/player_season_scores.csv
data/player_game_values.csv
```

and:

```text
pytest
```

passes.
