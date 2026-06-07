const test = require("node:test");
const assert = require("node:assert/strict");
const {
  careerWeights,
  playerTeamCareerScore,
  normalizedWeights,
  selectWindowsForPlayerTeam,
  windowScore,
} = require("../scripts/build_player_team_windows");

function row(overrides) {
  return {
    player_id: "1",
    player_name: "Test Star",
    season_id: 20002001,
    season_label: "2000-01",
    team: "PIT",
    position: "C",
    position_group: "F",
    player_type: "skater",
    rating_group: "forwards",
    rating: 80,
    salary: 20,
    game_points: 80,
    season_score: 1,
    adjusted_season_score: 1,
    source: "nhl_stats_api",
    ...overrides,
  };
}

const franchiseByTeam = new Map([
  ["PIT", {
    team: "PIT",
    team_name: "Pittsburgh Penguins",
    franchise_key: "PIT",
    franchise_name: "Pittsburgh Penguins",
    current_team: "PIT",
    franchise_status: "active",
  }],
]);

test("normalized weights keep available seasons proportional", () => {
  assert.deepEqual(normalizedWeights(1), [1]);
  assert.deepEqual(normalizedWeights(2), [0.625, 0.37499999999999994]);
  assert.deepEqual(normalizedWeights(3), [0.5, 0.3, 0.2]);
});

test("window score uses best three seasons inside the window", () => {
  const rows = [
    row({ season_id: 20002001, rating: 60, game_points: 60, salary: 11, adjusted_season_score: 0.6 }),
    row({ season_id: 20012002, rating: 90, game_points: 90, salary: 27, adjusted_season_score: 1.6 }),
    row({ season_id: 20022003, rating: 70, game_points: 70, salary: 16, adjusted_season_score: 0.8 }),
    row({ season_id: 20032004, rating: 100, game_points: 100, salary: 35, adjusted_season_score: 2 }),
  ];
  const score = windowScore(rows);

  assert.deepEqual(score.scoredRows.map((scoredRow) => scoredRow.season_id), [
    20032004,
    20012002,
    20022003,
  ]);
  assert.equal(score.rating, 91);
});

test("player-team career score uses weighted top seven seasons", () => {
  const rows = [100, 95, 90, 85, 80, 75, 70, 65]
    .map((rating, index) => row({
      season_id: Number(`${2000 + index}${2001 + index}`),
      rating,
      adjusted_season_score: rating,
    }));
  const score = playerTeamCareerScore(rows);

  assert.deepEqual(score.scoredRows.map((scoredRow) => scoredRow.rating), [
    100,
    95,
    90,
    85,
    80,
    75,
    70,
  ]);
  assert.equal(Number(score.rating.toFixed(2)), 89.05);
  assert.equal(careerWeights(1)[0], 1);
});

test("window row exposes base and career-adjusted ratings", () => {
  const rows = [
    row({ season_id: 20002001, season_label: "2000-01", rating: 80, adjusted_season_score: 1 }),
    row({ season_id: 20012002, season_label: "2001-02", rating: 90, adjusted_season_score: 2 }),
    row({ season_id: 20022003, season_label: "2002-03", rating: 100, adjusted_season_score: 3 }),
  ];
  const windows = selectWindowsForPlayerTeam(rows, franchiseByTeam);

  assert.equal("window_base_rating" in windows[0], true);
  assert.equal("player_team_career_rating" in windows[0], true);
  assert.equal(windows[0].window_rating, 93);
});

test("career modifier only boosts peak windows and never lowers ratings", () => {
  const rows = [
    row({ season_id: 20002001, season_label: "2000-01", rating: 100, adjusted_season_score: 3 }),
    row({ season_id: 20012002, season_label: "2001-02", rating: 90, adjusted_season_score: 2 }),
    row({ season_id: 20022003, season_label: "2002-03", rating: 80, adjusted_season_score: 1 }),
    row({ season_id: 20032004, season_label: "2003-04", rating: 40, adjusted_season_score: 0.4 }),
    row({ season_id: 20042005, season_label: "2004-05", rating: 40, adjusted_season_score: 0.4 }),
  ];
  const windows = selectWindowsForPlayerTeam(rows, franchiseByTeam);
  const early = windows.find((window) => window.window_type === "early");

  assert.equal(early.window_base_rating, 93);
  assert.equal(early.window_rating, 93);
});

test("player-team window selection returns distinct early peak late windows", () => {
  const rows = [
    row({ season_id: 20002001, season_label: "2000-01", rating: 65, adjusted_season_score: 0.6 }),
    row({ season_id: 20012002, season_label: "2001-02", rating: 75, adjusted_season_score: 0.9 }),
    row({ season_id: 20022003, season_label: "2002-03", rating: 85, adjusted_season_score: 1.2 }),
    row({ season_id: 20032004, season_label: "2003-04", rating: 70, adjusted_season_score: 0.8 }),
    row({ season_id: 20052006, season_label: "2005-06", rating: 80, adjusted_season_score: 1 }),
    row({ season_id: 20062007, season_label: "2006-07", rating: 95, adjusted_season_score: 1.8 }),
    row({ season_id: 20072008, season_label: "2007-08", rating: 90, adjusted_season_score: 1.5 }),
    row({ season_id: 20082009, season_label: "2008-09", rating: 88, adjusted_season_score: 1.4 }),
    row({ season_id: 20092010, season_label: "2009-10", rating: 68, adjusted_season_score: 0.7 }),
    row({ season_id: 20102011, season_label: "2010-11", rating: 82, adjusted_season_score: 1.1 }),
    row({ season_id: 20112012, season_label: "2011-12", rating: 83, adjusted_season_score: 1.2 }),
    row({ season_id: 20122013, season_label: "2012-13", rating: 84, adjusted_season_score: 1.3 }),
    row({ season_id: 20132014, season_label: "2013-14", rating: 85, adjusted_season_score: 1.4 }),
    row({ season_id: 20142015, season_label: "2014-15", rating: 86, adjusted_season_score: 1.5 }),
  ];

  const windows = selectWindowsForPlayerTeam(rows, franchiseByTeam);

  assert.deepEqual(windows.map((window) => window.window_type), ["early", "peak", "late"]);
  assert.equal(windows[0].scored_season_count, 3);
  assert.equal(windows[0].thin_window, "false");
});
