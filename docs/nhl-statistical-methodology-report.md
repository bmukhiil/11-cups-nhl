# NHL Historical Player Season Rating Methodology

## Purpose

This report documents the statistical method used to convert historical NHL player seasons into game-facing ratings.

The goal is to create a cross-era, position-aware rating system for a draft-based NHL game. The model is designed to be transparent, reproducible, and grounded in observable season-level statistics rather than manual player reputation scores.

This is not intended to be a definitive hockey WAR model. It is a game-oriented rating model built from public NHL season data, with explicit assumptions and known limitations.

## Data Source

Primary source:

```text
NHL Stats API
```

Main endpoints used:

```text
https://api.nhle.com/stats/rest/en/skater/summary
https://api.nhle.com/stats/rest/en/skater/realtime
https://api.nhle.com/stats/rest/en/goalie/summary
```

Only regular season data is used.

```text
gameTypeId = 2
```

The generated dataset currently covers NHL seasons from:

```text
1917-18 through 2025-26
```

## Unit of Observation

The base observation is:

```text
player + season + team
```

Example:

```text
Wayne Gretzky, 1984-85, EDM
Nicklas Lidstrom, 2001-02, DET
Connor Hellebuyck, 2024-25, WPG
```

Each row represents a single regular-season player-team-season.

## Exclusion Rules

The clean dataset excludes:

```text
multi-team seasons
seasons with fewer than 40 games played
rows with missing player identifiers
rows with missing player names
rows with missing team abbreviations
playoff rows
preseason rows
All-Star rows
```

Multi-team seasons are excluded because the first version of the game does not attempt to split player value across teams within the same season.

The 40-game threshold is used to reduce small-sample noise and ensure the season is meaningfully representative.

## Generated Datasets

Current output sizes:

```text
data/clean_player_seasons.csv   28,337 rows
data/player_season_zscores.csv  28,337 rows
data/player_season_scores.csv   28,337 rows
data/player_game_values.csv     14,168 rows
```

The first three files retain all cleaned player-seasons. The final game-values file keeps only the top 50% of each rating group.

Rating groups:

```text
forwards
defensemen
goalies
```

## Core Statistical Principle

Raw NHL statistics are not directly comparable across eras.

For example:

```text
1980s scoring environment
late-1990s / early-2000s dead-puck environment
modern scoring environment
Original Six and expansion-era environments
```

To address this, all major input statistics are converted into season-relative z-scores.

For a statistic `x`:

```python
z = (player_value - season_mean) / season_std
```

This means each player is evaluated relative to the league environment in the same NHL season.

## League Context

For each season and player type, the model calculates the mean and standard deviation of each relevant statistic.

Skater context includes:

```text
goals
assists
points
plus_minus
shots
time_on_ice_per_game
power_play_points
short_handed_points
game_winning_goals
hits
blocked_shots
```

Goalie context includes:

```text
wins
save_percentage
goals_against_average
shutouts
shots_against
saves
```

Hits and blocked shots are retained for analysis but are not used in the current scoring formula because historical coverage is incomplete.

## Z-Score Handling Rules

If a player value is missing:

```python
z = 0
```

If a season standard deviation is missing or zero:

```python
z = 0
```

For goalie goals-against average, lower is better, so the z-score is inverted:

```python
gaa_z = -1 * ((gaa - season_mean_gaa) / season_std_gaa)
```

## Player Season Score

Each player-season receives a continuous `season_score`.

The formula differs by position group.

## Forward Formula

Applies to:

```text
C, L, R, LW, RW
```

Formula:

```python
forward_score =
  0.30 * goals_z
+ 0.30 * assists_z
+ 0.16 * points_z
+ 0.09 * plus_minus_z
+ 0.10 * shots_z
+ 0.05 * power_play_points_z
```

Rationale:

```text
Goals and assists are the primary offensive drivers.
Points capture total production.
Shots proxy repeatable offensive pressure.
Power-play points capture elite offensive usage.
Plus-minus is included lightly as a team/context signal.
```

## Defenseman Formula

Applies to:

```text
D
```

Formula:

```python
defense_score =
  0.15 * goals_z
+ 0.25 * assists_z
+ 0.17 * points_z
+ 0.13 * plus_minus_z
+ 0.15 * time_on_ice_per_game_z
+ 0.15 * shots_z
```

Rationale:

```text
Defensemen are not scored like forwards.
Assists, points, ice time, and shots receive meaningful weight.
Goals matter, but less than for forwards.
Plus-minus is included as a light impact/context signal.
Hits and blocked shots are excluded because they are not reliably available historically.
```

## Goalie Formula

Applies to:

```text
G
```

Formula:

```python
goalie_score =
  0.35 * save_percentage_z
+ 0.20 * wins_z
+ 0.20 * goals_against_average_z
+ 0.15 * shutouts_z
+ 0.10 * saves_z
```

Rationale:

```text
Save percentage is the strongest goalie performance statistic available in the current dataset.
Wins and goals-against average are included but are team-influenced.
Shutouts reward dominant outcomes.
Saves reward workload.
```

## Reliability Adjustment

After computing `season_score`, the model applies a games-played reliability adjustment.

Skaters:

```python
reliability = min(1.0, games_played / 65)
```

Goalies:

```python
reliability = min(1.0, games_played / 40)
```

Adjusted score:

```python
adjusted_season_score = season_score * reliability
```

This prevents short-sample seasons from being treated the same as full seasons.

Known issue:

```text
Shortened NHL seasons, such as lockout seasons, may be over-penalized by this fixed threshold.
```

A future improvement is to calculate reliability relative to the maximum games played in that NHL season.

## Game-Facing Candidate Pool

The model does not use the entire cleaned population for final game ratings.

Instead:

```text
All cleaned player-seasons receive z-scores and season scores.
Only the top 50% of each rating group are included in player_game_values.csv.
```

This is intentional.

The game is not expected to use replacement-level or low-end NHL seasons. Scaling all 28,337 clean rows into the same game-rating space compressed the actually useful player pool.

Therefore, the game-facing rating scale is built from:

```text
top 50% of forwards
top 50% of defensemen
top 50% of goalies
```

Current game-facing counts:

```text
forwards:    8,905
defensemen:  4,503
goalies:       760
total:      14,168
```

## Rating Transformation

Ratings are derived from `adjusted_season_score`, not directly from raw stats.

Within each rating group:

1. Winsorize `adjusted_season_score` at the 0.1st and 99.9th percentiles.
2. Rank seasons by winsorized score.
3. Drop rows below the 50th percentile.
4. For the remaining top half, calculate mean and standard deviation of `adjusted_season_score`.
5. Convert each remaining season to a game-score z-score:

```python
game_score_z = (adjusted_season_score - top_half_mean) / top_half_std
```

6. Map `game_score_z` to a 0-100 rating using fixed anchors.

Current rating anchors:

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

Linear interpolation is used between anchors.

Final ratings are clamped between:

```text
0 and 100
```

## Why This Is Not a Pure Percentile Score

The model originally tested percentile-based ratings. That approach created excessive compression at the top end, because rank alone does not measure distance between elite seasons.

The current model uses score distance:

```text
How far is this season above the average game-facing season?
```

This better distinguishes strong seasons from true historical outliers.

## Salary and Game Points

Game points:

```python
game_points = round(rating)
```

Salary:

```python
salary = round(5 + 30 * (rating / 100) ** 3)
```

This makes elite players disproportionately expensive.

Examples:

```text
100 rating -> 35 salary
90 rating  -> 27 salary
80 rating  -> 20 salary
70 rating  -> 15 salary
50 rating  -> 9 salary
```

## Current Rating Distribution

For `player_game_values.csv`:

```text
count: 14,168
min: 16
p10: 24
p25: 31
median: 44
mean: 47.96
p75: 63
p90: 78
p95: 86
p99: 96
max: 100
standard deviation: 20.38
```

Interpretation:

```text
Most game-facing seasons are between 25 and 65.
Good seasons are generally in the 70s.
Great seasons are generally in the 80s.
Elite seasons are generally 90+.
Historical outliers are generally 95-100.
```

## Current Position Distribution

Forwards:

```text
count: 8,905
median: 44
mean: 47.98
p90: 78
p95: 85
p99: 96
max: 100
```

Defensemen:

```text
count: 4,503
median: 43
mean: 47.89
p90: 79
p95: 86
p99: 97
max: 100
```

Goalies:

```text
count: 760
median: 46
mean: 48.08
p90: 78
p95: 87
p99: 94
max: 100
```

## Strengths of the Method

The model is:

```text
transparent
reproducible
position-aware
era-normalized
based on public NHL data
not manually assigning player prestige values
able to distinguish raw production from era-relative dominance
```

It avoids direct raw-stat comparisons across eras.

It also avoids using modern-only fields such as hits, blocked shots, zone starts, and SAT/Corsi-style metrics in core scoring, because those fields are not consistently available across NHL history.

## Known Limitations

The model does not currently include:

```text
playoff performance
award voting
manual reputation adjustments
quality of competition
zone starts
teammate quality
penalty-kill role
strength-specific skater impacts
advanced possession metrics across all eras
era-depth adjustments
season-length adjusted reliability
```

This means some player-seasons may be under- or over-valued for reasons the available historical box-score data cannot capture.

Examples:

```text
Shortened seasons can be penalized by the fixed reliability threshold.
Defensive defensemen may be under-described without reliable historical defensive usage metrics.
Playoff-defining seasons are not boosted.
Older-era and modern-era advanced metrics are not treated asymmetrically.
```

## Design Philosophy

The score is not intended to be a claim of absolute player quality.

It is a structured game rating built from:

```text
season-relative statistical dominance
position-specific formulas
games-played reliability
top-half game-pool filtering
score-distance rating transformation
```

The purpose is to create a fair, inspectable, and tunable foundation for a historical NHL draft game.

## Review Questions for a Statistician

Useful questions to evaluate:

```text
Are z-scores appropriate given the distribution of NHL player stats?
Should the model use robust scaling instead of mean/std for heavily skewed stats?
Should shortened seasons use season-relative games-played reliability?
Are the position formulas weighted reasonably?
Is the top-half selection rule statistically defensible for a game-facing dataset?
Is the final z-to-rating curve appropriate for game design?
Should goalie scores include qualityStartsPct given its historical availability?
```

