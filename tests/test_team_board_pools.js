const test = require("node:test");
const assert = require("node:assert/strict");
const {
  eraBucket,
  eraWeight,
  isEligible,
  ratingWeight,
  TEAM_BOARD_POOL_COLUMNS,
} = require("../scripts/build_team_board_pools");

const options = {
  minSkaterGames: 70,
  minGoalieGames: 40,
};

function row(overrides) {
  return {
    season_id: 20242025,
    position_group: "F",
    games_played: 82,
    rating: 70,
    ...overrides,
  };
}

test("era buckets map seasons to product recency groups", () => {
  assert.equal(eraBucket(row({ season_id: 19551956 })), "pre1960");
  assert.equal(eraBucket(row({ season_id: 19791980 })), "1970s");
  assert.equal(eraBucket(row({ season_id: 19841985 })), "1980s");
  assert.equal(eraBucket(row({ season_id: 20242025 })), "2020s");
});

test("era weights bias toward modern seasons while preserving older legends", () => {
  assert.equal(eraWeight("2020s"), 1.3);
  assert.equal(eraWeight("1980s"), 1);
  assert.equal(eraWeight("pre1960"), 0.3);
});

test("rating weight increases with rating above the pool floor", () => {
  assert.equal(ratingWeight(row({ rating: 60 }), 60), 1);
  assert.equal(ratingWeight(row({ rating: 85 }), 60), 1.25);
  assert.equal(ratingWeight(row({ rating: 30 }), 60), 1);
});

test("board-pool eligibility uses skater and goalie games floors", () => {
  assert.equal(isEligible(row({ rating: 29 }), 30, options), false);
  assert.equal(isEligible(row({ rating: 30, games_played: 70 }), 30, options), true);
  assert.equal(isEligible(row({ rating: 30, games_played: 69 }), 30, options), false);
  assert.equal(isEligible(row({
    rating: 30,
    position_group: "G",
    games_played: 40,
  }), 30, options), true);
});

test("board-pool schema includes selection type for forced top cards", () => {
  assert.equal(TEAM_BOARD_POOL_COLUMNS.includes("selection_type"), true);
});
