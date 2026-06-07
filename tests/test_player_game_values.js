const test = require("node:test");
const assert = require("node:assert/strict");
const {
  defenseScore,
  forwardScore,
  goalieScore,
  ratingFromZScore,
  salaryFromRating,
  topHalfPercentile,
  zScore,
} = require("../scripts/build_player_game_values");

test("z-score returns 0 when std is 0", () => {
  assert.equal(zScore(10, { mean: 5, std: 0 }), 0);
});

test("z-score returns 0 when player value is blank", () => {
  assert.equal(zScore("", { mean: 5, std: 2 }), 0);
});

test("goalie GAA z-score is inverted", () => {
  assert.equal(zScore(2, { mean: 3, std: 1 }, true), 1);
});

test("forward formula uses expected weights", () => {
  const row = {
    goals_z: 1,
    assists_z: 1,
    points_z: 1,
    plus_minus_z: 1,
    shots_z: 1,
    power_play_points_z: 1,
  };
  assert.equal(Number(forwardScore(row).toFixed(10)), 1);
});

test("defenseman formula uses expected weights", () => {
  const row = {
    goals_z: 1,
    assists_z: 1,
    points_z: 1,
    plus_minus_z: 1,
    time_on_ice_per_game_z: 1,
    shots_z: 1,
  };
  assert.equal(Number(defenseScore(row).toFixed(10)), 1);
});

test("goalie formula uses expected weights", () => {
  const row = {
    save_percentage_z: 1,
    wins_z: 1,
    goals_against_average_z: 1,
    shutouts_z: 1,
    saves_z: 1,
  };
  assert.equal(Number(goalieScore(row).toFixed(10)), 1);
});

test("rating z-score interpolation maps anchors", () => {
  assert.equal(ratingFromZScore(-2), 0);
  assert.equal(ratingFromZScore(0), 50);
  assert.equal(ratingFromZScore(2), 86);
  assert.equal(ratingFromZScore(4.25), 100);
});

test("top-half percentile scaling maps bottom half to 0", () => {
  assert.equal(topHalfPercentile(0.25), 0);
  assert.equal(topHalfPercentile(0.5), 0);
  assert.equal(topHalfPercentile(1), 1);
});

test("salary formula maps 100 rating to 35", () => {
  assert.equal(salaryFromRating(100), 35);
});
