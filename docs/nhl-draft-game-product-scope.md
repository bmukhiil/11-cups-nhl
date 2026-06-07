# NHL Draft Game Product Scope

## Product Goal

Build a hockey draft game inspired by the Six Rings format, using our Hockey-Reference card surface as the statistical backbone.

The player should draft the best possible hockey roster under a salary cap, then receive a score and outcome framing around whether the roster can win championships.

## Core Game Loop

1. Start a new draft.
2. The game chooses a random NHL franchise for the current pick board.
3. The player sees a board of random cards from that franchise pool.
4. The player selects one card or uses a lifeline.
5. The selected card fills a roster slot and counts against the salary cap.
6. Repeat until the roster is complete.
7. Score the final roster.
8. Compare the score to game thresholds or percentile outcomes.
9. Present the result as a championship outcome, including the "Can you win 6 rings?" framing.

## Roster Format

The drafted roster has 7 total players:

```text
2 C
2 W
2 D
1 G
```

The roster should enforce positional requirements. A card can only fill an eligible open slot.

## Draft Board

Each pick presents a board of player cards.

Target board size:

```text
10 cards
```

Board generation:

- Choose a random current NHL franchise.
- Pull cards from that franchise's playable board pool.
- Show enough positional variety to keep the draft playable.
- Future behavior may bias boards toward open roster needs.

## Player Card Source

Cards are generated from Hockey-Reference season-level Point Shares.

The card surface uses:

- `raw_card_ps`
- `raw_card_ops`
- `raw_card_dps`
- `raw_card_gps`

For skaters:

```text
raw_card_ps = raw_card_ops + raw_card_dps
```

For goalies:

```text
raw_card_ps = raw_card_gps
```

## Card Versions

Cards represent meaningful versions of a player's career:

```text
early
peak
late
```

Current rule:

- `early`: arrival/early-career season.
- `peak`: best eligible season with that gameplay franchise.
- `late`: late-career season distinct from early/peak where possible.

If early and peak would use the same season, early falls back to the player's first eligible season with that franchise.

## Eligibility And Duplication Rules

Playable card eligibility:

```text
Skaters: games_played >= 65
Goalies: games_played >= 40
```

Duplication limits:

```text
max_cards_per_player_franchise = 3
max_cards_per_player_total = 4
```

The game should not allow too many versions of the same player to dominate the playable surface.

## Franchise Mapping

Gameplay uses current NHL franchise buckets.

Historical teams map into current gameplay franchises.

Examples:

```text
QUE -> COL
HFD -> CAR
MNS -> DAL
Seals/Barons -> DAL
ARI/PHX/WIN -> UTA
```

The source historical team can remain as metadata, but gameplay boards use the mapped `franchise_key`.

## Team Pool Size

Each current NHL franchise targets:

```text
100 playable cards
```

Known exceptions:

- Seattle may have fewer cards because of short franchise history.
- Vegas may have fewer cards because of short franchise history.

These teams should use all eligible cards rather than force low-quality or fake filler.

## Visible Card Information

Before selection, the draft card should show only game-facing information:

- Player name
- Headshot
- Franchise/team
- Position
- Card version/season
- Overall rating
- Salary/cap hit

The draft board should not show the detailed Hockey-Reference Point Shares breakdown before the player commits.

## Hidden Until Selection

Detailed statistical components are hidden until after a card is selected.

For skaters, reveal after selection:

```text
Offensive impact: raw_card_ops
Defensive impact: raw_card_dps
Total impact: raw_card_ps
```

For goalies, reveal after selection:

```text
Goalie impact: raw_card_gps
Total impact: raw_card_ps
```

This gives the draft a mystery-box feel while still preserving transparency after the player commits.

## Lifelines

The draft should include limited-use lifelines:

```text
Reshuffle board, same team
Reshuffle board, different team
Reshuffle board, same team with chosen position
```

These should be scarce enough to matter strategically.

## Salary Cap And Scoring

The final game needs a rating and salary layer on top of raw Point Shares.

Still to lock:

- Raw Point Shares to 0-100 rating curve.
- Salary/cap value formula.
- Salary cap number.
- Final roster score formula.
- Championship / rings thresholds.
- Percentile simulation method.

The current Hockey-Reference output is the statistical base, not the final gameplay balance layer.

## Headshots

Headshots can be derived from Hockey-Reference player IDs.

URL pattern:

```text
https://www.hockey-reference.com/req/202301051/images/headshots/{player_id}.jpg
```

Downloaded files should be stored locally by `player_id`.

Example:

```text
sakicjo01 -> data/hockey_reference_headshots/sakicjo01.jpg
```

## Open Decisions

- Final rating curve.
- Final salary cap number.
- Whether duplicate players are blocked within a single draft.
- Whether draft boards should be purely random or roster-need aware.
- How many lifelines the player receives.
- How the "six rings" result maps from roster score to outcome.
- Whether post-selection stat reveal happens immediately or only in the final roster summary.
