const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isEligibleForGameSubset,
  selectRepresentativeSeasons,
} = require("../scripts/build_game_subset");

const options = {
  minRating: 60,
  minSkaterGames: 70,
  minGoalieGames: 40,
  maxSeasonsPerPlayer: 3,
};

function row(overrides) {
  return {
    player_id: "1",
    player_name: "Test Player",
    season_id: 20002001,
    season_label: "2000-01",
    team: "EDM",
    position: "C",
    position_group: "F",
    player_type: "skater",
    games_played: 82,
    season_score: 1,
    adjusted_season_score: 1,
    rating_group: "forwards",
    rating: 75,
    salary: 18,
    game_points: 75,
    source: "nhl_stats_api",
    ...overrides,
  };
}

test("game subset eligibility uses skater and goalie games floors", () => {
  assert.equal(isEligibleForGameSubset(row({ games_played: 69 }), options), false);
  assert.equal(isEligibleForGameSubset(row({ games_played: 70 }), options), true);
  assert.equal(isEligibleForGameSubset(row({ rating: 59, games_played: 82 }), options), false);
  assert.equal(isEligibleForGameSubset(row({
    position: "G",
    position_group: "G",
    player_type: "goalie",
    rating_group: "goalies",
    games_played: 40,
  }), options), true);
});

test("representative selection keeps top three team chapters when player has three-plus teams", () => {
  const seasons = [
    row({ season_id: 20002001, team: "EDM", rating: 70, adjusted_season_score: 0.7 }),
    row({ season_id: 20012002, team: "EDM", rating: 97, adjusted_season_score: 2.1 }),
    row({ season_id: 20022003, team: "LAK", rating: 95, adjusted_season_score: 2 }),
    row({ season_id: 20092010, team: "NYR", rating: 82, adjusted_season_score: 1.1 }),
    row({ season_id: 20102011, team: "STL", rating: 68, adjusted_season_score: 0.6 }),
  ];

  const selected = selectRepresentativeSeasons(seasons, options);

  assert.deepEqual(selected.map((selectedRow) => selectedRow.season_id), [
    20012002,
    20022003,
    20092010,
  ]);
});

test("representative selection keeps two team chapters plus early-career best", () => {
  const seasons = [
    row({ season_id: 20002001, team: "TOR", rating: 70, adjusted_season_score: 0.7 }),
    row({ season_id: 20012002, team: "TOR", rating: 86, adjusted_season_score: 1.5 }),
    row({ season_id: 20082009, team: "PIT", rating: 88, adjusted_season_score: 1.7 }),
    row({ season_id: 20092010, team: "PIT", rating: 75, adjusted_season_score: 0.9 }),
  ];

  const selected = selectRepresentativeSeasons(seasons, options);

  assert.deepEqual(selected.map((selectedRow) => selectedRow.season_id), [
    20082009,
    20012002,
    20002001,
  ]);
});

test("representative selection uses early-career best, best overall, and latest for one-team players", () => {
  const seasons = [
    row({ season_id: 20002001, rating: 62, adjusted_season_score: 0.3 }),
    row({ season_id: 20012002, rating: 75, adjusted_season_score: 0.8 }),
    row({ season_id: 20022003, rating: 97, adjusted_season_score: 2.1 }),
    row({ season_id: 20092010, rating: 82, adjusted_season_score: 1.1 }),
  ];

  const selected = selectRepresentativeSeasons(seasons, options);

  assert.deepEqual(selected.map((selectedRow) => selectedRow.season_id), [
    20022003,
    20092010,
    20012002,
  ]);
});
