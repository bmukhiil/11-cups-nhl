const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLEAN_COLUMNS,
  normalizeGoalie,
  normalizeSkater,
  positionGroup,
  seasonLabel,
} = require("../scripts/pipeline_common");

test("season_label converts NHL season id", () => {
  assert.equal(seasonLabel(20242025), "2024-25");
});

test("position_group maps positions", () => {
  for (const position of ["C", "L", "R", "LW", "RW"]) {
    assert.equal(positionGroup(position), "F");
  }
  assert.equal(positionGroup("D"), "D");
  assert.equal(positionGroup("G"), "G");
});

test("single-team skater row is kept and joined with realtime", () => {
  const row = normalizeSkater({
    playerId: 1,
    skaterFullName: "Test Skater",
    seasonId: 20242025,
    teamAbbrevs: "EDM",
    positionCode: "C",
    gamesPlayed: 82,
    goals: 50,
    assists: 60,
    points: 110,
  }, {
    hits: 12,
    blockedShots: 8,
  });

  assert.equal(row.player_name, "Test Skater");
  assert.equal(row.team, "EDM");
  assert.equal(row.hits, 12);
  assert.equal(row.blocked_shots, 8);
  assert.equal(row.wins, "");
  assert.deepEqual(Object.keys(row), CLEAN_COLUMNS);
});

test("multi-team skater row is dropped", () => {
  const row = normalizeSkater({
    playerId: 1,
    skaterFullName: "Test Skater",
    seasonId: 20242025,
    teamAbbrevs: "COL,CAR",
    positionCode: "R",
    gamesPlayed: 82,
  });
  assert.equal(row, null);
});

test("row under 40 games is dropped", () => {
  const row = normalizeSkater({
    playerId: 1,
    skaterFullName: "Test Skater",
    seasonId: 20242025,
    teamAbbrevs: "EDM",
    positionCode: "C",
    gamesPlayed: 39,
  });
  assert.equal(row, null);
});

test("missing player_id is dropped", () => {
  const row = normalizeSkater({
    skaterFullName: "Test Skater",
    seasonId: 20242025,
    teamAbbrevs: "EDM",
    positionCode: "C",
    gamesPlayed: 82,
  });
  assert.equal(row, null);
});

test("goalie row maps goalie fields and blanks skater fields", () => {
  const row = normalizeGoalie({
    playerId: 2,
    goalieFullName: "Test Goalie",
    seasonId: 20242025,
    teamAbbrevs: "WPG",
    gamesPlayed: 60,
    wins: 40,
    losses: 10,
    otLosses: 5,
    savePct: 0.925,
    goalsAgainstAverage: 2.1,
    shutouts: 7,
    goalsAgainst: 120,
    shotsAgainst: 1600,
    saves: 1480,
  });

  assert.equal(row.player_name, "Test Goalie");
  assert.equal(row.position, "G");
  assert.equal(row.save_percentage, 0.925);
  assert.equal(row.goals, "");
  assert.deepEqual(Object.keys(row), CLEAN_COLUMNS);
});
