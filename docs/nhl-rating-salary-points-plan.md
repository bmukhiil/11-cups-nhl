# NHL Ratings, Salary, and Points Plan

## Purpose

Define how the game will turn `data/clean_player_seasons.csv` into scored player seasons, ratings, salary cap values, and draft-game point values.

This document assumes the clean data phase already exists and produces one row per valid NHL regular season:

```text
player + season + team
```

The goal of this phase is to create a game-usable dataset from clean season stats.

## Input Dataset

Primary input:

```text
data/clean_player_seasons.csv
```

Expected grain:

```text
one player
one regular season
one NHL team
minimum 40 games played
```

Required input fields:

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

## Phase 1 Output Files

This phase should generate:

```text
data/league_season_context.csv
data/player_season_zscores.csv
data/player_season_scores.csv
data/player_game_values.csv
```

Later phases may generate:

```text
data/selected_player_seasons.csv
data/game_players.csv
data/team_pools.csv
```

## Core Principle

Raw stats are not directly comparable across eras.

Example:

```text
1980s scoring environment
2000s dead-puck scoring environment
2020s scoring environment
```

The rating system must compare each player to the league environment of that same season.

Therefore, all primary scoring starts with season-relative z-scores.

## League Context

For each `season_id`, calculate league-level mean and standard deviation for each stat used in scoring.

Skater context:

```text
goals_mean
goals_std
assists_mean
assists_std
points_mean
points_std
plus_minus_mean
plus_minus_std
shots_mean
shots_std
time_on_ice_per_game_mean
time_on_ice_per_game_std
hits_mean
hits_std
blocked_shots_mean
blocked_shots_std
power_play_points_mean
power_play_points_std
short_handed_points_mean
short_handed_points_std
game_winning_goals_mean
game_winning_goals_std
```

Goalie context:

```text
wins_mean
wins_std
save_percentage_mean
save_percentage_std
goals_against_average_mean
goals_against_average_std
shutouts_mean
shutouts_std
shots_against_mean
shots_against_std
saves_mean
saves_std
```

Output:

```text
data/league_season_context.csv
```

Recommended columns:

```text
season_id
player_type
stat_name
mean
std
eligible_player_count
```

## Eligibility for League Context

League context is calculated from:

```text
data/clean_player_seasons.csv
```

This means league context uses the same version 1 universe as the playable scoring dataset:

```text
single-team regular seasons
games_played >= 40
```

Do not calculate version 1 league context from raw API rows.

Reason:

```text
The scoring artifacts should be reproducible from the cleaned dataset alone.
Using raw rows for context would create a hidden dependency and include players who are not eligible for the game dataset.
```

If a future version needs broader historical league context, implement it as a separate artifact:

```text
data/raw_league_context.csv
```

That is out of scope for version 1.

## Z-Score Generation

For every player-season, convert selected raw stats into season-relative z-scores.

Formula:

```python
z_score = (player_value - season_mean) / season_std
```

If `season_std` is zero or missing:

```python
z_score = 0
```

If a stat is blank or unavailable for a player-season:

```python
z_score = 0
```

Hits and blocked shots are retained in the z-score output for analysis, but they are not used in version 1 scoring because they are not consistently available across historical seasons.

Output:

```text
data/player_season_zscores.csv
```

Recommended columns:

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

Important goalie rule:

```text
Lower goals_against_average is better.
```

Therefore:

```python
gaa_z = -1 * ((goals_against_average - season_mean_gaa) / season_std_gaa)
```

## Player Season Score

The player season score is the main performance score before converting to game ratings.

Output:

```text
data/player_season_scores.csv
```

Recommended columns:

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
offense_score
defense_context_score
goalie_score
```

## Forward Formula

Applies when:

```text
position_group = F
```

Initial formula:

```python
forward_score =
  0.30 * goals_z
+ 0.30 * assists_z
+ 0.16 * points_z
+ 0.09 * plus_minus_z
+ 0.10 * shots_z
+ 0.05 * power_play_points_z
```

Reasoning:

```text
Goals and assists matter most.
Points reinforce total production.
Plus-minus adds light team/context signal.
Shots add repeatable offensive pressure.
Power play production rewards elite offensive usage.
Hits and blocked shots are excluded from scoring for historical fairness.
```

## Defenseman Formula

Applies when:

```text
position_group = D
```

Initial formula:

```python
defense_score =
  0.15 * goals_z
+ 0.25 * assists_z
+ 0.17 * points_z
+ 0.13 * plus_minus_z
+ 0.15 * time_on_ice_per_game_z
+ 0.15 * shots_z
```

Reasoning:

```text
Defensemen should not be scored like forwards.
Assists, plus-minus, and ice time matter more.
Goals still matter, but less than they do for forwards.
Hits and blocked shots are excluded from scoring because they are modern-biased fields with poor historical coverage.
```

## Goalie Formula

Applies when:

```text
player_type = goalie
```

Initial formula:

```python
goalie_score =
  0.35 * save_percentage_z
+ 0.20 * wins_z
+ 0.20 * gaa_z
+ 0.15 * shutouts_z
+ 0.10 * saves_z
```

Reasoning:

```text
Save percentage is the strongest goalie stat in this dataset.
Wins matter but are team-influenced.
Goals against average matters but is also team-influenced.
Shutouts reward dominant seasons.
Saves reward workload.
```

## Games Played Reliability Adjustment

Dominant small-sample seasons should not be treated the same as full seasons.

Apply a reliability multiplier after calculating `season_score`.

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

Use `adjusted_season_score` for ratings.

Keep the raw `season_score` for auditing.

Rationale:

```text
Skaters reach full reliability at 65 games because that is a strong full-season sample without requiring perfect health.
Goalies reach full reliability at 40 games because goalie workloads are naturally lower than skater workloads.
Players already lose statistical volume by playing fewer games, so the reliability adjustment should be a light stability check, not a second major penalty.
```

## Rating Conversion

Convert adjusted season scores into game ratings.

Ratings should be easy to understand:

```text
100 = all-time elite season
90-99 = superstar season
80-89 = star season
70-79 = strong season
60-69 = usable depth season
50-59 = low-end included season
```

Initial rating range:

```text
0 to 100
```

Required method:

1. Calculate adjusted season scores for all eligible player seasons.
2. Split rows by rating group.
3. Winsorize adjusted scores within each rating group.
4. Convert winsorized scores to percentile rank within each rating group.
5. Drop rows below the 50th percentile within each rating group.
6. Calculate the mean and standard deviation of `adjusted_season_score` for the remaining top half.
7. Convert each remaining row to a game-score z-score.
8. Map game-score z-score to a 0-100 rating using fixed anchors.

Winsorization rule:

```python
lower_bound = percentile(adjusted_season_score, 0.1)
upper_bound = percentile(adjusted_season_score, 99.9)
winsorized_score = min(max(adjusted_season_score, lower_bound), upper_bound)
```

Percentile rule:

```python
percentile_rank = rank(winsorized_score) / (count_in_rating_group - 1)
```

Use ascending rank, where the lowest score has percentile `0.0` and the highest score has percentile `1.0`.

If a rating group has only one row:

```python
percentile_rank = 1.0
```

Top-half filter:

```python
if percentile_rank < 0.5:
    drop_from_player_game_values()
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

Linearly interpolate between anchors.

Clamp final rating between 0 and 100.

This means `player_season_scores.csv` still contains every clean player-season, while `player_game_values.csv` contains only the top half of forwards, defensemen, and goalies.

## Rating Groups

Ratings should be calibrated separately by broad player type:

```text
forwards
defensemen
goalies
```

Reason:

```text
Goalie scores and skater scores are built from different stats.
Defensemen should not need forward-level point production to receive strong ratings.
```

## Salary Cap Formula

Salary should punish elite ratings more aggressively than mid-tier ratings.

Initial formula:

```python
salary = round(5 + 30 * (rating / 100) ** 3)
```

Expected output:

```text
100 rating -> 35 salary
95 rating  -> 31 salary
90 rating  -> 27 salary
85 rating  -> 23 salary
80 rating  -> 20 salary
75 rating  -> 18 salary
70 rating  -> 15 salary
65 rating  -> 13 salary
60 rating  -> 11 salary
55 rating  -> 10 salary
50 rating  -> 9 salary
```

Minimum salary:

```text
5
```

Maximum initial salary:

```text
35
```

Salary may later be adjusted by simulation.

## Game Points System

The game needs a points system separate from rating.

Rating answers:

```text
How good is this season overall?
```

Game points answer:

```text
How many projected game points does this player contribute to a drafted roster?
```

Initial points formula:

```python
game_points = round(rating * 1.0)
```

This means the first version uses rating directly as the point contribution.

Example:

```text
100 rating -> 100 game points
92 rating  -> 92 game points
75 rating  -> 75 game points
```

This is intentionally simple for version 1.

## Position-Adjusted Game Points

Optional later adjustment:

```python
game_points = round(rating * position_multiplier)
```

Initial multipliers:

```text
F -> 1.00
D -> 1.00
G -> 1.00
```

No position multiplier is applied in version 1.

If roster construction later makes one position too valuable or too weak, this can be adjusted after simulations.

## Player Game Value Output

Output:

```text
data/player_game_values.csv
```

Recommended columns:

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

This file is the bridge between statistical scoring and game design.

It intentionally excludes the bottom 50% of each rating group so the final game-facing rating scale is not compressed by player-seasons that are unlikely to be used.

## Future Season Selection

The final game should probably not include every season for every player.

Expected future rule:

```text
Select 3-6 distinct seasons per important player.
```

Potential selection logic:

```text
best overall season
best goal-scoring season
best assist/playmaking season
best championship-era season
best late-career season
best team-specific season
```

This is out of scope for the first rating pass.

The first rating pass should score every clean season.

## Future Team Pool Logic

Team and era grouping comes after player-season scoring.

Possible future game rows:

```text
Sidney Crosby, PIT, 2006-07
Sidney Crosby, PIT, 2013-14
Sidney Crosby, PIT, 2015-16
Connor McDavid, EDM, 2016-17
Connor McDavid, EDM, 2020-21
Connor McDavid, EDM, 2022-23
```

This approach keeps MVP seasons, rookie seasons, and late-career seasons distinct.

## Simulation-Based Salary Balancing

Initial salaries come from the formula.

Later, run draft simulations to identify bad prices.

Track:

```text
most drafted players
most common winning players
highest ROI players
lowest ROI players
overpriced ratings
underpriced ratings
position imbalance
team imbalance
```

Adjustment examples:

```text
If a 100-rated player appears on too many winning teams, increase salary.
If an 88-rated player rarely appears on winning teams, lower salary.
If goalies are always ignored, increase goalie points or lower goalie salary.
If defensemen are always ignored, adjust defense rating formula or salary.
```

This is not part of the first scoring implementation.

## Version 1 Scope

Version 1 includes:

```text
league context
z-scores
position-specific season scores
games-played reliability adjustment
ratings
salary formula
game points equal to rating
player_game_values.csv
```

Version 1 excludes:

```text
award voting
playoff performance
manual player curation
era grouping
team pools
draft simulation
salary rebalance
roster construction rules
```

## First Completion Definition

This phase is complete when the project can generate:

```text
data/league_season_context.csv
data/player_season_zscores.csv
data/player_season_scores.csv
data/player_game_values.csv
```

from:

```text
data/clean_player_seasons.csv
```

with no manual editing.

The input file is expected to have already removed player-seasons with fewer than 40 games played.
