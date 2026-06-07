const test = require("node:test");
const assert = require("node:assert/strict");
const {
  poolRowsForTeam,
} = require("../scripts/build_team_window_board_pools");

function row(overrides) {
  return {
    window_card_id: "1-PIT-early-20002001",
    player_id: "1",
    player_name: "Test Star",
    historical_team: "PIT",
    team_name: "Pittsburgh Penguins",
    franchise_key: "PIT",
    franchise_name: "Pittsburgh Penguins",
    current_team: "PIT",
    franchise_status: "active",
    position: "C",
    position_group: "F",
    player_type: "skater",
    rating_group: "forwards",
    window_type: "early",
    window_label: "2000-01 to 2004-05",
    window_start_season_id: 20002001,
    window_end_season_id: 20042005,
    window_season_count: 5,
    scored_season_count: 3,
    thin_window: "false",
    component_season_ids: "20002001|20012002|20022003",
    component_season_labels: "2000-01|2001-02|2002-03",
    component_ratings: "90|80|70",
    component_weights: "0.5|0.3|0.2",
    window_rating: 80,
    window_salary: 20,
    window_game_points: 80,
    window_adjusted_season_score: 1,
    window_season_score: 1,
    source: "player_team_5yr_window",
    ...overrides,
  };
}

test("window board pool keeps at most three cards per player", () => {
  const rows = [
    row({ window_card_id: "a", window_rating: 100 }),
    row({ window_card_id: "b", window_rating: 99, window_type: "peak" }),
    row({ window_card_id: "c", window_rating: 98, window_type: "late" }),
    row({ window_card_id: "d", window_rating: 97, window_type: "extra" }),
    row({ window_card_id: "e", player_id: "2", player_name: "Other Star", window_rating: 96 }),
  ];

  const pool = poolRowsForTeam(rows, {
    maxCardsPerTeam: 100,
    forcedTopCards: 25,
    primaryMinRating: 60,
    backupMinRating: 30,
    emergencyMinRating: 0,
    maxCardsPerPlayer: 3,
  });

  assert.equal(pool.filter((candidate) => candidate.player_id === "1").length, 3);
  assert.equal(pool.length, 4);
});
