# Hockey-Reference Point Shares Migration Plan

## Goal

Migrate the game rating backbone to a Hockey-Reference Point Shares signal while keeping our existing game-product rules.

The main objective is not to use one career value per player. The objective is to use Hockey-Reference season-level value fields as the statistical base, then reshape those seasons into our game format:

```text
player seasons -> franchise mapping -> 5-year windows -> player/team cards -> franchise board pools
```

The game should still support:

- Team/franchise-specific cards.
- Distinct player versions by team and career phase.
- A target of roughly 100 playable cards per current NHL franchise.
- Modern-player bias without erasing historical legends.
- Separate offensive, defensive, goalie, and total value signals.

## Core Data Source

Use Hockey-Reference player-season data.

The key requirement is season-level data, not only career leaderboards.

### Skater Season Fields

Required fields:

```text
player_id
player_name
season
age
team
league
position
games_played
goals
assists
points
plus_minus
ops
dps
ps
```

Definitions:

```text
OPS = Offensive Point Shares
DPS = Defensive Point Shares
PS  = Total Point Shares
```

### Goalie Season Fields

Required fields:

```text
player_id
player_name
season
age
team
league
position
games_played
games_started
wins
losses
save_percentage
gaa
gps
ps
```

Definitions:

```text
GPS = Goalie Point Shares
PS  = Total Point Shares
```

## Raw Value Rule

Do not normalize Hockey-Reference values to a 0-100 rating during the migration pass.

The first Hockey-Reference dataset should preserve actual Point Shares values:

```text
raw_ps
raw_ops
raw_dps
raw_gps
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
```

Reason:

- Hockey-Reference values are already meaningful statistical outputs.
- Keeping raw values makes spot checks easier.
- We can compare players without immediately forcing game scaling.
- The 0-100 rating layer should be a later game-balancing step.

This means the migration output should produce raw card values first. Game ratings, salary cap values, and board balancing can be layered on after.

## Franchise Mapping

Historical Hockey-Reference team codes must be mapped into current-game franchise keys.

The game should use:

```text
franchise_key
```

The source team should still be retained as:

```text
historical_team
```

Examples:

```text
QUE -> COL
MNS -> DAL
ATL -> CGY
KCS/COL Rockies lineage -> NJD
Seals/Barons lineage -> DAL
```

The franchise map should follow our gameplay rule: historical teams roll up into current NHL franchises.

## Multi-Team Season Rule

Drop player-seasons where a player appeared for multiple teams in the same season.

Do not use `TOT` rows.

Reason:

- The game needs clean team ownership.
- Multi-team years create ambiguous franchise assignment.
- Most traded seasons are not important enough to complicate the card pool.

## Eligibility Rules

Season eligibility applies before card construction.

### Skaters

```text
games_played >= 70
```

### Goalies

```text
games_played >= 40
```

These thresholds are for playable cards, not for describing the full source universe.

## Season Value Model

### Skaters

Use Hockey-Reference values directly:

```text
season_total_value = PS
season_offense_value = OPS
season_defense_value = DPS
```

Fallback if `PS` is missing:

```text
season_total_value = OPS + DPS
```

### Goalies

Use goalie Point Shares:

```text
season_total_value = GPS
season_goalie_value = GPS
```

Fallback if only `PS` exists:

```text
season_total_value = PS
```

## Card Construction Philosophy

Cards should represent meaningful versions of a player, not just duplicate their three best individual seasons.

Each player-franchise combination can generate up to 3 cards:

```text
early
peak
late
```

Each card should be based on a 5-year window, using the best 3 eligible seasons inside that window.

This gives us:

- Less single-season outlier noise.
- Better representation of distinct career phases.
- Cleaner team-specific player versions.

## Card Types

### Early Card

Use the player's first 5 eligible seasons with that franchise.

Select the best 3 eligible seasons inside that early span.

Purpose:

- Captures the arrival/young version of the player.
- Avoids over-penalizing bad rookie years.

### Peak Card

Find the strongest 5-year window with that franchise.

Select the best 3 eligible seasons inside that window.

Purpose:

- Captures the player's best team-specific version.

### Late Card

Use the player's final 5 eligible seasons with that franchise.

Select the best 3 eligible seasons inside that late span.

Purpose:

- Captures the veteran/late-career version.

## Card Score Calculation

For every candidate card, calculate raw weighted Point Share values.

Recommended weights:

```text
best season:        50%
second-best season: 30%
third-best season:  20%
```

### Skater Card Values

```text
raw_card_ps  = weighted_average(best_3_PS)
raw_card_ops = weighted_average(best_3_OPS)
raw_card_dps = weighted_average(best_3_DPS)
```

### Goalie Card Values

```text
raw_card_gps = weighted_average(best_3_GPS)
raw_card_ps  = weighted_average(best_3_PS or GPS)
```

Do not convert these to 0-100 ratings in this pass.

## Multi-Team Career Handling

Players can have cards for multiple franchises if they had meaningful eligible seasons for each franchise.

Examples:

```text
Phil Kessel -> TOR, PIT
Roberto Luongo -> VAN, FLA
Jack Eichel -> BUF, VGK
Brad Marchand -> BOS, FLA if eligible
```

Rules:

```text
max_cards_per_player_franchise = 3
recommended_max_total_cards_per_player = 5
```

The per-franchise cap is more important than the global cap because the game is team-board driven.

## Team Pool Construction

Each current NHL franchise should target:

```text
target_cards_per_franchise = 100
```

Some newer franchises may not reach 100 clean cards.

Examples:

```text
SEA may be below 100
VGK may need most eligible cards
UTA/ARI depends on final lineage mapping
```

## Modern Bias Rule

The final team pool should favor modern players while preserving legends.

Recommended priority:

```text
2020s: very high
2010s: very high
2000s: high
1990s: medium-high
1980s: medium
1970s: protected legend priority
1960s and earlier: limited legend priority
```

Practical selection order:

1. Lock obvious franchise legends.
2. Fill with modern and recent core players.
3. Add strong historical cards.
4. Stop when the team reaches the target pool size.
5. Avoid letting Original Six teams become overloaded with old-era cards.
6. Avoid punishing newer franchises for shorter histories.

## Legend Protection

Historical legends should remain available even if modern bias would otherwise push them down.

Examples:

```text
Jean Beliveau
Maurice Richard
Guy Lafleur
Bobby Orr
Gordie Howe
Wayne Gretzky
Mario Lemieux
```

Recommended guardrails:

```text
minimum_legend_slots_for_legacy_franchises = 10
maximum_pre_1980_cards_soft_cap = 25
```

These are pool-construction rules, not scoring rules.

## Output Files

### Clean Hockey-Reference Season Dataset

```text
data/hockey_reference_player_seasons_clean.csv
```

One row per cleaned player-season.

### Candidate Card Windows

```text
data/hockey_reference_card_windows.csv
```

One row per generated player-franchise-window candidate.

### Final Raw Playable Cards

```text
data/playable_cards_hockey_reference_raw.csv
```

Main game-ready card dataset using raw Hockey-Reference values.

### Team Board Pools

```text
data/team_board_pools_hockey_reference_raw.csv
```

Final franchise board pools targeting 100 cards per current NHL franchise.

## Raw Playable Card Schema

```text
card_id
player_id
player_name
position_group
position
franchise_key
historical_team
card_type
card_label
start_season
end_season
selected_seasons
season_count
games_played_total
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
era_bucket
is_legend
is_modern
source
```

Do not include final `overall_rating`, `salary_cap_value`, or normalized `0-100` fields in the first raw migration output unless they are clearly marked as experimental.

## Deferred Game Scaling

The following should happen after the raw Hockey-Reference card dataset exists:

```text
raw_card values -> game rating curve -> salary cap value -> gameplay balancing
```

Deferred fields:

```text
offense_rating
defense_rating
goalie_rating
overall_rating
salary_cap_value
```

These should be generated in a later pass after we inspect the raw distributions.

## Validation Spot Checks

After generating the raw Hockey-Reference card pool, compare against known cases.

### Forwards

- Gretzky should be the strongest or near-strongest offensive signal.
- Lemieux should remain elite despite lower career volume.
- Crosby should likely compare favorably to Malkin when sustained value is considered.
- Jagr should remain elite.
- Ovechkin should remain elite.
- McDavid should be elite on peak windows even though his career total is still active.

### Defensemen

- Orr should remain top tier.
- Bourque should be elite.
- Lidstrom should be elite.
- Chara should receive meaningful defensive credit.
- Pure offensive defensemen should not automatically dominate all-around defensemen.

### Goalies

- Brodeur should look much stronger than in our current custom model.
- Roy should remain elite.
- Hasek should likely be elite if present.
- Luongo should benefit from strong career/team value.
- Short-peak goalies should not automatically outrank historic workhorse goalies.

## Implementation Steps

1. Ingest Hockey-Reference player-season data.
2. Normalize player IDs, names, seasons, teams, positions, and numeric fields.
3. Remove non-NHL rows if needed.
4. Remove `TOT` rows and multi-team seasons.
5. Apply franchise mapping.
6. Apply season eligibility thresholds.
7. Split into position groups: `F`, `D`, `G`.
8. Preserve raw Hockey-Reference values.
9. Generate eligible 5-year windows per player-franchise.
10. Generate early, peak, and late candidate cards.
11. Calculate raw weighted card values.
12. Deduplicate near-identical cards.
13. Apply max-card rules per player-franchise.
14. Build franchise pools targeting 100 cards.
15. Apply modern bias and legend protection.
16. Export raw CSV products.
17. Run spot checks against our existing cards.
18. Review outliers manually.
19. Only then design the game rating and salary cap scaling layer.

## Decision To Lock

We are not using Hockey-Reference career Point Shares as one career number.

We are using Hockey-Reference season-level Point Shares as the statistical signal, then applying our own game rules:

```text
season stats -> franchise mapping -> 5-year windows -> early/peak/late cards -> team pools
```

The first migration output should preserve raw Hockey-Reference values. Normalized game ratings come later.
