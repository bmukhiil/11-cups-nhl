# Player Handedness Enrichment Plan

## Objective

Add real player handedness to the NHL draft game surface so compatibility scoring can use:

```text
shoots = L | R | unknown
```

For goalies, NHL's `shootsCatches` value should still be stored in the same `shoots` output column because the game only needs left/right balance semantics.

## Current State

The active game surface is:

```text
data/team_board_pools_hockey_reference_raw.csv
```

It contains Hockey-Reference card rows with:

```text
player_id          Hockey-Reference slug, example sakicjo01
player_name
position
historical_team
card_label
selected_seasons
raw_card_ps
raw_card_ops
raw_card_dps
raw_card_gps
```

It does not contain:

```text
shoots
catches
shootsCatches
handedness
```

The existing NHL Stats API cleaned file is:

```text
data/clean_player_seasons.csv
```

It contains numeric NHL IDs:

```text
player_id          NHL numeric id, example 8445744
player_name
season_id
season_label
team
position
position_group
```

It does not contain handedness, but it can be used as the bridge from Hockey-Reference cards to NHL player IDs.

## Target Outputs

Create a stable mapping file:

```text
data/player_handedness.csv
```

Schema:

```text
hr_player_id
nhl_player_id
player_name
shoots
source
match_method
match_confidence
notes
```

Rules:

```text
shoots = L | R | unknown
source = nhl_api | manual_override | unresolved
match_method = exact_name_season_team | exact_name_season | manual_override | unresolved
match_confidence = high | medium | low | none
```

Then create an enriched game surface:

```text
data/team_board_pools_hockey_reference_enriched.csv
```

Same schema as `team_board_pools_hockey_reference_raw.csv`, plus:

```text
shoots
handedness_source
handedness_match_confidence
```

The app should load the enriched file when present, and fall back to the raw file when not present.

## Data Source

Use the NHL player landing endpoint:

```text
https://api-web.nhle.com/v1/player/{nhl_player_id}/landing
```

Expected field:

```text
shootsCatches
```

Valid normalized values:

```text
L
R
unknown
```

## Mapping Strategy

The hard part is not fetching handedness. The hard part is mapping:

```text
Hockey-Reference player_id -> NHL numeric player_id
```

We should do this locally before making API calls.

### Step 1: Build Unique HR Player List

Read:

```text
data/team_board_pools_hockey_reference_raw.csv
```

Group by:

```text
player_id
player_name
```

Keep supporting card context:

```text
historical_team
card_label
selected_seasons
position
```

### Step 2: Build NHL Candidate Index

Read:

```text
data/clean_player_seasons.csv
```

Group by:

```text
player_name
season_label
team
position
```

Each candidate contains:

```text
nhl_player_id
player_name
season_label
team
position
position_group
```

### Step 3: Match HR Players to NHL IDs

For each unique HR player, try these match tiers in order.

Tier 1: exact name + exact selected/card season + exact team

```text
HR player_name == NHL player_name
HR selected_seasons/card_label contains NHL season_label
HR historical_team == NHL team
```

Use when exactly one NHL player ID is found.

Result:

```text
match_method = exact_name_season_team
match_confidence = high
```

Tier 2: exact name + exact selected/card season

```text
HR player_name == NHL player_name
HR selected_seasons/card_label contains NHL season_label
```

Use when exactly one NHL player ID is found.

Result:

```text
match_method = exact_name_season
match_confidence = medium
```

Tier 3: manual override

Use:

```text
data/player_id_manual_overrides.csv
```

Schema:

```text
hr_player_id,nhl_player_id,player_name,notes
```

Result:

```text
match_method = manual_override
match_confidence = high
```

Tier 4: unresolved

If no unique match exists:

```text
nhl_player_id =
shoots = unknown
source = unresolved
match_confidence = none
```

Do not guess on fuzzy matches in the first pass.

## NHL API Fetch Strategy

Create cache directory:

```text
data/nhl_player_landing_cache/
```

For each matched NHL player ID:

```text
data/nhl_player_landing_cache/{nhl_player_id}.json
```

Rules:

1. If cache file exists, read it and do not call the API.
2. If cache file is missing, call the NHL player landing endpoint.
3. Wait 1-2 seconds between uncached API calls.
4. On request failure, write an unresolved row and continue.
5. The script must be resumable. Stopping midway should not lose completed cache/files.

This is much lighter than Hockey-Reference scraping because the NHL endpoint is JSON and we only need one call per unique matched NHL player ID.

## Normalization Rules

Normalize `shootsCatches`:

```text
L -> L
R -> R
Left -> L
Right -> R
blank/null/missing -> unknown
```

For skaters:

```text
shootsCatches means shoots
```

For goalies:

```text
shootsCatches means catches
```

But output still stores:

```text
shoots
```

because the game only needs left/right compatibility.

## App Integration

Update server load order:

1. Prefer:

```text
data/team_board_pools_hockey_reference_enriched.csv
```

2. Fallback:

```text
data/team_board_pools_hockey_reference_raw.csv
```

The existing app already supports:

```text
card.shoots
```

So once the enriched CSV exists, the UI and compatibility score should work without more frontend changes.

## Validation Checks

After running enrichment, output a summary:

```text
unique_hr_players
matched_to_nhl_id
unresolved_players
handedness_l
handedness_r
handedness_unknown
high_confidence_matches
medium_confidence_matches
manual_overrides
```

Expected first-pass target:

```text
>= 70% unique HR players matched
>= 85% modern players matched
```

Older historical players may remain unresolved because the NHL API may not have complete landing records for them.

## Spot Checks

After enrichment, verify known players:

```text
Connor McDavid -> L
Sidney Crosby -> L
Alex Ovechkin -> R
Mario Lemieux -> R
Wayne Gretzky -> L
Nicklas Lidstrom -> L
Zdeno Chara -> L
Patrick Roy -> L
Dominik Hasek -> L
```

If a known obvious player is unresolved, add a manual override only after confirming the NHL ID.

## Implementation Files

Add:

```text
scripts/enrich_player_handedness_from_nhl_api.js
data/player_handedness.csv
data/team_board_pools_hockey_reference_enriched.csv
data/nhl_player_landing_cache/
```

Optional manual override:

```text
data/player_id_manual_overrides.csv
```

## Implementation Order

1. Build the local HR-to-NHL matching logic.
2. Write unresolved/matched mapping output without making API calls.
3. Review match coverage.
4. Add NHL API fetching with cache and throttle.
5. Write `player_handedness.csv`.
6. Join handedness into the game surface.
7. Update server to prefer enriched game surface.
8. Restart app and verify card handedness appears.
9. Run a complete draft and confirm handedness compatibility bonuses can be earned.

