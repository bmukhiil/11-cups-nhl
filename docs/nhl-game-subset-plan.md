# NHL Game Subset Plan

## Purpose

Define the first simplified game-facing subset of the historical NHL player-season dataset.

The inspiration is a lightweight draft game like SixRings, where the user repeatedly chooses the most impactful player-season from a limited set of options and then receives a final score.

The source game describes the loop as choosing impactful players and chasing a final "6-ring score." The NHL version should use the same core idea:

```text
small choices
clear player-season cards
impact reveal
final score
shareable result
```

This document defines the first subset rules so the game does not have to load or reason over the full generated dataset.

## Source Dataset

Input:

```text
data/player_game_values.csv
```

This file already contains:

```text
top 50% of forwards
top 50% of defensemen
top 50% of goalies
0-100 game-facing ratings
salary values
game_points
```

Current size:

```text
14,168 player-season rows
```

This is still too large for the first playable version.

## First Game Subset Output

Output:

```text
data/game_subset_player_seasons.csv
```

Gameplay-enriched output:

```text
data/game_subset_player_seasons_enriched.csv
```

Board-pool output:

```text
data/team_board_pools.csv
```

Window-card outputs:

```text
data/player_team_5yr_windows.csv
data/team_board_pools_5yr.csv
```

The enriched file adds franchise gameplay mapping fields to every playable card:

```text
historical_team
team_name
franchise_key
franchise_name
current_team
franchise_status
```

For gameplay, `franchise_key` and `current_team` must always map to a current NHL team abbreviation.
Historical team identity is preserved in `historical_team` and `team_name`.

Each row is one playable card:

```text
player + season + team
```

Example:

```text
Wayne Gretzky, 1984-85, EDM
Nicklas Lidstrom, 2001-02, DET
Connor Hellebuyck, 2024-25, WPG
```

## Launch Subset Rules

Rule 1: Use only meaningful game-facing seasons.

```text
rating >= 60
```

Reason:

```text
The first version should focus on players/seasons that are plausible draft options.
Lower-rated rows remain useful for analysis but are unlikely to be chosen in a simplified game.
```

Rule 1b: Apply gameplay games-played floors.

```text
skaters: games_played >= 70
goalies: games_played >= 40
```

Reason:

```text
The playable pool should avoid partial skater seasons.
Goalies use a lower floor because high-end starting goalie seasons commonly fall below 70 games.
```

Rule 2: Limit repeated player seasons.

```text
max 3 seasons per player
```

Reason:

```text
The full data contains many repeated elite seasons for players like Wayne Gretzky, Bobby Orr, Mario Lemieux, and others.
The game needs recognizable variation without letting one player dominate the pool.
```

Rule 3: Select up to three representative seasons per player.

The intent is to avoid using three nearly identical peak seasons when a player has a long career, while preserving distinct team chapters when a player mattered for more than one franchise.

For each player, select from eligible seasons only:

```text
if player has 3+ eligible teams:
  best season from the top 3 team chapters

if player has 2 eligible teams:
  best season from each team chapter
  best available season from the player's first 2 eligible seasons

if player has 1 eligible team:
  best season from the player's first 2 eligible seasons
  best overall eligible season
  latest eligible season
```

If those produce fewer than 3 unique seasons because of overlap, fill the remaining slots with next-best eligible seasons.

Best-season sort order:

```text
rating descending
adjusted_season_score descending
season_id ascending
player_name ascending
```

Team chapter sort order:

```text
best season within team chapter
then rank team chapters by that best season
```

Reason:

```text
The generated pool should capture different career stages without manual curation.
Players with meaningful careers on multiple teams should have those team chapters represented in the playable pool.
Using the best season from the first 2 eligible years avoids overfitting to weak rookie seasons.
The source data does not currently contain awards, playoff results, or narrative milestones, so version 1 cannot reliably choose story-specific seasons unless those seasons also emerge from the statistical rules.
```

Rule 4: Keep all positions.

Do not manually force roster balance in the subset file.

The subset should preserve the natural distribution of:

```text
forwards
defensemen
goalies
```

Game presentation can handle positional constraints later.

Rule 5: No manual reputation overrides.

Do not add or remove players manually in version 1.

Reason:

```text
This subset should remain reproducible from the statistical pipeline.
Manual curation can happen later as a separate layer.
```

Rule 6: Map historical teams to current gameplay franchises.

Use:

```text
data/franchise_map.csv
```

Gameplay grouping should use:

```text
franchise_key
```

Every row must have a non-empty `current_team`.

Relocations and renames map to their current franchise:

```text
QUE -> COL
HFD -> CAR
MNS -> DAL
WIN/PHX/ARI -> UTA
ATL -> WPG
AFM -> CGY
TSP -> TOR
```

Merged or defunct historical teams are also mapped to current teams for gameplay:

```text
CGS/OAK/CLE -> DAL
MMR -> MTL
NYA/BRK -> NYR
PIR -> PIT
QUA -> PHI
SEN -> OTT
SLE -> STL
```

Reason:

```text
The game should not create separate historical-only team buckets in version 1.
Cards can still display the original historical team while scoring, filtering, and bonuses use current franchise keys.
```

## Expected Size

Based on the previous generated ratings before the 70-game skater floor:

```text
rating >= 60 produces 4,011 rows and 1,043 unique players.
rating >= 60 plus max 3 seasons per player produces about 2,296 rows.
```

Expected distribution:

```text
forwards:    about 1,434
defensemen:  about   687
goalies:     about   175
total:       about 2,296
```

This is a practical first launch pool.

## Why Not Use All 14,168 Game Values?

The full game-values file is still useful for analysis, tuning, and future modes.

But for the first game, it is too broad:

```text
too many low-impact choices
too many repeated seasons for the same stars
too much surface area for UI and balancing
```

The subset should behave more like a curated card pool while still being generated automatically.

## Draft Product Shape

Roster target:

```text
2 C
2 W
2 D
1 G
```

Position mapping:

```text
C -> center slot
L/R/LW/RW -> wing slot
D -> defense slot
G -> goalie slot
```

Each pick should generate a board from one current gameplay franchise:

```text
choose random current franchise
show 10 random eligible player-season cards from that franchise
show each card's salary cap cost
user picks 1 card
```

The user's objective:

```text
build the highest-value 7-player team under the salary cap
```

Initial lifelines:

```text
reshuffle same team
reshuffle different team
reshuffle same team and choose position
```

Scoring should later convert the final roster score into a percentile and ring result.
The exact salary cap, percentile curve, and "can you win 6 rings" thresholds are product-balancing decisions that should be simulated after this card pool is locked.

## Team Board Pool Rules

The master playable pool should remain statistically clean.
The team board pool is a separate product-balancing layer used to generate draft boards.

The preferred game-facing model is now the 5-year window-card pool, not raw single-season cards.

Window-card grain:

```text
player_id + historical_team + window_type
```

Gameplay grouping:

```text
franchise_key
```

This preserves distinct player-team chapters while still mapping relocated teams to current gameplay franchises.

Examples:

```text
Phil Kessel BOS / TOR / PIT are separate team chapters.
Wayne Gretzky EDM / LAK / NYR are separate team chapters.
Joe Sakic QUE and COL both map to the COL gameplay board.
```

For each player-team chapter, generate up to three cards:

```text
early: best 3 eligible seasons from first 5 calendar seasons with that team
peak: best 3 eligible seasons from strongest 5-calendar-season stretch with that team
late: best 3 eligible seasons from last 5 calendar seasons with that team
```

Window scoring:

```text
best component season:   50%
second component season: 30%
third component season:  20%
```

If fewer than three eligible seasons exist, use available seasons and normalize the weights.
Mark those rows as:

```text
thin_window = true
```

Reason:

```text
Single-season cards can overrate one-year spikes.
Five-year windows better represent what the player was for that team chapter.
Early / peak / late windows preserve distinct phases for long one-team careers.
```

Output:

```text
data/team_board_pools.csv
data/team_board_pools_5yr.csv
```

Single-season board-pool target:

```text
100 weighted board slots per current NHL franchise
32 current franchises
3,200 total board-pool rows
```

Window board-pool target:

```text
up to 100 unique weighted window cards per current NHL franchise
no duplicate physical rows
max 3 cards per player per current franchise
```

Important distinction:

```text
The single-season board pool uses duplicated weighted slots.
The 5-year window board pool uses one row per unique window card with `draw_weight`.
The 5-year version is preferred because it directly enforces the max-3-player rule.
```

Primary source:

```text
data/game_subset_player_seasons_enriched.csv
```

Primary eligibility:

```text
rating >= 60
skaters games_played >= 70
goalies games_played >= 40
```

Backup source for teams with fewer than 100 primary unique cards:

```text
data/player_game_values.csv
data/franchise_map.csv
```

Backup eligibility:

```text
rating >= 30
skaters games_played >= 70
goalies games_played >= 40
```

Emergency eligibility for ultra-thin teams:

```text
rating >= 0
skaters games_played >= 70
goalies games_played >= 40
```

Emergency rows are only used when a franchise cannot reach 100 candidate cards or 100 board slots under the normal primary and backup tiers.

Era weights:

```text
2020s:   1.30
2010s:   1.25
2000s:   1.15
1990s:   1.05
1980s:   1.00
1970s:   0.70
1960s:   0.50
pre1960: 0.30
```

Rating weight:

```text
rating_weight = 1 + max(0, rating - pool_rating_floor) / 100
draw_weight = era_weight * rating_weight
```

Slot caps:

```text
max 8 slots per player per franchise
max 4 slots per player-season card per franchise
```

Forced elite inclusion:

```text
Before weighted filling, force-include each franchise's top 25 unique cards by rating.
The remaining 75 slots are filled with the recency-weighted draw system.
```

Top-card sort order:

```text
rating descending
adjusted_season_score descending
season_id ascending
player_name ascending
```

Reason:

```text
Every team should have the same board surface area.
Obvious elite cards should never be excluded by random weighted sampling.
Modern seasons should appear more often, especially from the 1980s onward.
Older legends should remain available without dominating old franchises.
Expansion teams should be playable even when they have fewer than 100 distinct high-rated cards.
Low-rated emergency filler should be isolated to teams that mathematically need it.
```

## Future Subset Variants

The same pipeline can later generate:

```text
all-time elite mode: rating >= 80
deep-cut mode: rating 40-75
team-specific mode
decade-specific mode
modern-only mode
goalie-excluded mode
salary-cap challenge mode
```

Do not build these variants yet.

## Done Definition

This phase is complete when the project can generate:

```text
data/game_subset_player_seasons.csv
data/game_subset_player_seasons_enriched.csv
data/team_board_pools.csv
data/player_team_5yr_windows.csv
data/team_board_pools_5yr.csv
```

from:

```text
data/player_game_values.csv
data/franchise_map.csv
```

using:

```text
rating >= 60
skaters games_played >= 70
goalies games_played >= 40
max 3 seasons per player
representative career-stage season selection
no manual curation
current-team franchise mapping for gameplay
5-year player-team window cards
up to 100 weighted unique board cards per current franchise
```
