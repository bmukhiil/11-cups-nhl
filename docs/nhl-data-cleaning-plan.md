# NHL Historical Data Cleaning Plan

## Purpose

Build the first clean source dataset for the NHL draft game.

The goal of this phase is not to create player ratings, team eras, salaries, or draft pools yet. The goal is to produce a reliable season-level dataset containing every usable NHL player season from the NHL Stats API.

This cleaned dataset will become the input for later scoring, normalization, season selection, team grouping, and game balancing.

## Locked Direction

The base dataset will be season-level.

The grain of the clean data is:

```text
player + season + team
```

For version 1, only single-team seasons are included.

This means:

```text
Connor McDavid, 2024-25, EDM
Sidney Crosby, 2013-14, PIT
Alex Ovechkin, 2007-08, WSH
```

are valid rows.

Multi-team seasons are excluded.

Example:

```text
Mikko Rantanen, 2024-25, COL,CAR,DAL
```

is dropped from the clean dataset.

## Why Season-Level First

Era grouping is intentionally deferred.

Players like Sidney Crosby, Connor McDavid, Alex Ovechkin, Wayne Gretzky, and Mario Lemieux can have meaningfully different versions across their careers:

```text
rookie season
MVP season
championship season
late-career season
```

If we group players into eras too early, we lose that detail.

The clean season-level dataset allows us to later choose the best 3-6 distinct seasons for a player, build era entries, build team entries, or support a single-season draft mode without rebuilding the source data.

## Primary Data Source

Primary source:

```text
NHL Stats API
```

Base URL:

```text
https://api.nhle.com/stats/rest/en
```

Skater endpoint:

```text
https://api.nhle.com/stats/rest/en/skater/summary
```

Goalie endpoint:

```text
https://api.nhle.com/stats/rest/en/goalie/summary
```

Regular season filter:

```text
gameTypeId=2
```

Season filter example:

```text
seasonId=20242025
```

Version 1 will use the NHL Stats API as the source of truth because it returns structured JSON with stable identifiers such as `playerId`, `seasonId`, and statistical fields.

Additional skater report:

```text
https://api.nhle.com/stats/rest/en/skater/realtime
```

This report is used to add hits and blocked shots when available.

## Validation Source

Secondary validation source:

```text
Hockey Reference
```

Hockey Reference may be used later to manually validate important player seasons, team abbreviations, or awards. It is not the primary ingestion source for version 1 because scraping HTML is more brittle than consuming structured JSON.

## Rejected Source

The Kaggle NHL Player Database is not the primary source for this project.

Reason:

```text
It does not include the team-season detail required for this game.
```

Team is essential because the game depends on player identity within a team context.

## Confirmed API Shape

Tested skater API call:

```text
https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22points%22,%22direction%22:%22DESC%22%7D%5D&start=0&limit=3&cayenneExp=gameTypeId=2%20and%20seasonId=20242025
```

Example skater response row:

```json
{
  "assists": 84,
  "evGoals": 29,
  "evPoints": 75,
  "faceoffWinPct": 0.5,
  "gameWinningGoals": 9,
  "gamesPlayed": 78,
  "goals": 37,
  "lastName": "Kucherov",
  "otGoals": 1,
  "penaltyMinutes": 45,
  "playerId": 8476453,
  "plusMinus": 22,
  "points": 121,
  "pointsPerGame": 1.55128,
  "positionCode": "R",
  "ppGoals": 8,
  "ppPoints": 46,
  "seasonId": 20242025,
  "shGoals": 0,
  "shPoints": 0,
  "shootingPct": 0.13962,
  "shootsCatches": "L",
  "shots": 265,
  "skaterFullName": "Nikita Kucherov",
  "teamAbbrevs": "TBL",
  "timeOnIcePerGame": 1271.3717
}
```

Confirmed skater realtime response fields:

```json
{
  "blockedShots": 30,
  "gamesPlayed": 78,
  "hits": 462,
  "playerId": 8480748,
  "positionCode": "L",
  "seasonId": 20242025,
  "skaterFullName": "Kiefer Sherwood",
  "teamAbbrevs": "VAN",
  "timeOnIcePerGame": 893.34
}
```

Confirmed goalie response row:

```json
{
  "gamesPlayed": 63,
  "gamesStarted": 62,
  "goalieFullName": "Connor Hellebuyck",
  "goalsAgainst": 125,
  "goalsAgainstAverage": 2.00461,
  "losses": 12,
  "otLosses": 3,
  "playerId": 8476945,
  "savePct": 0.92487,
  "saves": 1539,
  "seasonId": 20242025,
  "shotsAgainst": 1664,
  "shutouts": 8,
  "teamAbbrevs": "WPG",
  "ties": null,
  "timeOnIce": 224482,
  "wins": 47
}
```

Confirmed multi-team behavior:

```json
{
  "playerId": 8478420,
  "skaterFullName": "Mikko Rantanen",
  "seasonId": 20242025,
  "teamAbbrevs": "COL,CAR,DAL",
  "gamesPlayed": 82,
  "goals": 32,
  "assists": 56,
  "points": 88
}
```

This confirms that multi-team seasons can be detected by checking whether `teamAbbrevs` contains a comma.

## Version 1 Cleaning Rules

Only regular season rows are included.

```text
gameTypeId = 2
```

The following rows are included:

```text
single player
single season
single NHL team
regular season only
games_played >= 40
valid player_id
valid player name
valid team abbreviation
valid season_id
```

The following rows are excluded:

```text
multi-team seasons
rows with games_played < 40
playoff rows
preseason rows
All-Star rows
rows with missing player_id
rows with missing player name
rows with missing teamAbbrevs
rows with blank teamAbbrevs
rows with missing season_id
```

Multi-team season rule:

```python
if "," in teamAbbrevs:
    continue
```

Minimum games rule:

```python
if gamesPlayed < 40:
    continue
```

No dropped-player CSV will be produced in version 1.

Dropped multi-team seasons and low-games seasons are intentionally not managed, restored, audited, or manually recovered in this phase.

Rationale:

```text
Most traded seasons are not important enough for the first version of the game dataset, and the final game will only use a small selected subset of each player's best seasons.
Seasons under 40 games are too small to represent a stable player-season for the master game dataset.
```

## Clean Output File

Primary output:

```text
data/clean_player_seasons.csv
```

This is the only required CSV output for the first cleaning milestone.

Each row represents:

```text
one player
one NHL regular season
one NHL team
```

## Clean CSV Columns

Required columns:

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

Skater rows will have goalie-specific columns blank.

Goalie rows will have skater-specific columns blank.

## Normalized Field Mapping

Skater mapping:

```text
player_id              <- playerId
player_name            <- skaterFullName
season_id              <- seasonId
season_label           <- derived from seasonId
team                   <- teamAbbrevs
position               <- positionCode
position_group         <- derived from position
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
hits                   <- joined from skater/realtime hits
blocked_shots          <- joined from skater/realtime blockedShots
source                 <- "nhl_stats_api"
```

Goalie mapping:

```text
player_id              <- playerId
player_name            <- goalieFullName
season_id              <- seasonId
season_label           <- derived from seasonId
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

## Season Label Rule

`season_id` is an integer in NHL format:

```text
20242025
```

`season_label` should be derived as:

```text
2024-25
```

Example:

```python
start_year = str(season_id)[:4]
end_year = str(season_id)[4:]
season_label = f"{start_year}-{end_year[-2:]}"
```

## Position Group Rule

Position groups:

```text
C  -> F
L  -> F
R  -> F
LW -> F
RW -> F
D  -> D
G  -> G
```

If the API uses `L` or `R`, preserve that exact value in `position`, but normalize `position_group` to `F`.

## Version 1 Ingestion Strategy

For version 1, we can pull season-level summaries, join skater realtime data, and filter out multi-team rows.

Season range:

```text
start_season_id = 19171918
end_season_id = latest completed NHL regular season configured for the run
```

The implementation must accept an explicit `end_season_id` so the generated dataset is reproducible.

Example:

```text
end_season_id = 20252026
```

Pagination:

```text
Use limit=-1 when the endpoint supports it.
If limit=-1 fails, paginate with start and limit until the number of collected rows equals the API total.
Recommended page size: 1000.
```

Process:

```text
For each season_id
  Pull skater summary for regular season
  Pull skater realtime for regular season
  Pull goalie summary for regular season
  Join skater summary + realtime by player_id, season_id, and teamAbbrevs
  For each row
    Validate required identifiers
    Drop if teamAbbrevs is missing
    Drop if teamAbbrevs contains comma
    Drop if gamesPlayed is less than 40
    Normalize field names
    Derive season_label
    Derive position_group
    Write clean row
```

We do not need team-by-team API pulls in version 1 because multi-team rows are excluded.

Hits and blocked shots are included when available.

If the realtime report does not contain usable hits or blocked shots for a historical season, write blank values for those fields. Do not synthesize historical hits or blocks.

## Later Derived Outputs

These are intentionally out of scope for the first cleaning milestone:

```text
league_context_by_season.csv
player_season_zscores.csv
player_season_scores.csv
selected_player_seasons.csv
team_era_player_entries.csv
team_era_pools.csv
game_players.csv
salary_values.csv
```

Those files depend on `data/clean_player_seasons.csv`.

## Later Grouping Questions

Era grouping is not locked yet.

Possible future approaches:

```text
single-season draft entries
team-era player entries
career-team player entries
best 3-6 selected seasons per player
```

The current expectation is that the final game may only load a small number of distinct seasons per player, likely 3-6, to create variation without overwhelming the draft pool.

Examples:

```text
Sidney Crosby, 2006-07, PIT
Sidney Crosby, 2013-14, PIT
Sidney Crosby, 2015-16, PIT
Sidney Crosby, 2021-22, PIT
```

But that selection logic comes after the cleaned source dataset exists.

## First Milestone Definition

The first milestone is complete when the project can generate:

```text
data/clean_player_seasons.csv
```

from the NHL Stats API.

The file must:

```text
contain skaters and goalies
contain regular season data only
contain only single-team seasons
contain only seasons with games_played >= 40
contain normalized column names
contain season labels
contain position groups
exclude multi-team seasons
exclude low-games seasons
exclude invalid identifier rows
```

No scoring, z-scores, salaries, team eras, or draft pools are required for this milestone.
