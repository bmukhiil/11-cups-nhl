const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RING_THRESHOLDS,
  compatibilityForDraft,
  generateBoard,
  useLifeline,
} = require("../app/gameEngine");

function card(rawPs) {
  return {
    card_id: `card-${rawPs}`,
    player_id: `player-${rawPs}`,
    player_name: `Player ${rawPs}`,
    franchise_key: "PIT",
    historical_team: "PIT",
    position: "C",
    position_group: "F",
    card_type: "peak",
    card_label: "2020-21",
    selected_seasons: "2020-21",
    games_played_total: 82,
    raw_card_ps: rawPs,
    raw_card_ops: rawPs,
    raw_card_dps: 0,
    raw_card_gps: "",
    assigned_slot: "C",
  };
}

function positionedCard(id, position, rawPs, shoots = "L", assignedSlot = undefined) {
  return {
    card_id: `card-${id}`,
    player_id: `player-${id}`,
    player_name: `Player ${id}`,
    franchise_key: "PIT",
    historical_team: "PIT",
    position,
    position_group: position === "G" ? "G" : "F",
    card_type: "peak",
    card_label: "2020-21",
    selected_seasons: "2020-21",
    games_played_total: 82,
    raw_card_ps: rawPs,
    raw_card_ops: rawPs,
    raw_card_dps: 0,
    raw_card_gps: position === "G" ? rawPs : "",
    shoots,
    assigned_slot: assignedSlot,
  };
}

test("ring thresholds use product-calibrated score bands", () => {
  assert.deepEqual(
    RING_THRESHOLDS.map((item) => [item.rings, item.score]),
    [
      [6, 95],
      [5, 90],
      [4, 85],
      [3, 80],
      [2, 75],
      [1, 70],
      [0, 0],
    ],
  );
});

test("compatibility score preserves raw score when no modifiers apply", () => {
  const selectedCards = [card(40), card(35), card(5)];
  const state = {
    selectedCards,
    roster: {
      C: selectedCards,
      W: [],
      D: [],
      G: [],
    },
  };

  const result = compatibilityForDraft(state);

  assert.equal(result.rawScore, 80);
  assert.equal(result.finalScore, 80);
});

test("forward flex penalties use heavier product debuffs", () => {
  const centerAtWing = positionedCard("center-wing", "C", 10, "L", "W");
  const wingAtCenter = positionedCard("wing-center", "RW", 10, "R", "C");
  const state = {
    selectedCards: [centerAtWing, wingAtCenter],
    roster: {
      C: [wingAtCenter],
      W: [centerAtWing],
      D: [],
      G: [],
    },
  };

  const result = compatibilityForDraft(state);
  const centerFit = result.positionFits.find((item) => item.cardId === centerAtWing.card_id);
  const wingFit = result.positionFits.find((item) => item.cardId === wingAtCenter.card_id);

  assert.equal(centerFit.modifier, 0.8);
  assert.equal(centerFit.adjustedScore, 8);
  assert.equal(wingFit.modifier, 0.7);
  assert.equal(wingFit.adjustedScore, 7);
});

test("wing compatibility uses LW/RW side balance instead of handedness", () => {
  const leftWing = positionedCard("lw", "LW", 10, "R", "W");
  const rightWing = positionedCard("rw", "RW", 10, "R", "W");
  const state = {
    selectedCards: [leftWing, rightWing],
    roster: {
      C: [],
      W: [leftWing, rightWing],
      D: [],
      G: [],
    },
  };

  const result = compatibilityForDraft(state);
  const wingBonus = result.handednessBonuses.find((item) => item.slot === "W");

  assert.equal(wingBonus.label, "Wing side balance");
  assert.deepEqual(wingBonus.hands, ["LW", "RW"]);
  assert.equal(wingBonus.earned, true);
  assert.equal(wingBonus.bonusPct, 0.015);
});

function boardCard(index, rawPs, franchiseKey = "PIT") {
  return {
    card_id: `${franchiseKey}-bucket-card-${index}`,
    player_id: `${franchiseKey}-bucket-player-${index}`,
    player_name: `Bucket Player ${index}`,
    franchise_key: franchiseKey,
    historical_team: franchiseKey,
    position: "C",
    position_group: "F",
    card_type: "peak",
    card_label: "2020-21",
    selected_seasons: "2020-21",
    games_played_total: 82,
    raw_card_ps: rawPs,
    raw_card_ops: rawPs,
    raw_card_dps: 0,
    raw_card_gps: "",
  };
}

function draftState() {
  return {
    roster: { C: [], W: [], D: [], G: [] },
    selectedPlayerIds: new Set(),
    shownCardIds: new Set(),
    shownFranchiseKeys: new Set(),
  };
}

test("generated boards use bounded team-relative quality buckets", () => {
  const cards = Array.from({ length: 100 }, (_, index) => boardCard(index + 1, index + 1));
  const state = draftState();

  const result = generateBoard({
    byTeam: new Map([["PIT", cards]]),
    teams: ["PIT"],
    state,
    team: "PIT",
  });

  const high = result.board.filter((item) => item.raw_card_ps >= 75.25).length;
  const low = result.board.filter((item) => item.raw_card_ps <= 35.65).length;
  const mid = result.board.length - high - low;

  assert.equal(result.board.length, 10);
  assert.equal(high >= 1 && high <= 3, true);
  assert.equal(mid >= 4 && mid <= 6, true);
  assert.equal(low >= 2 && low <= 4, true);
});

test("generated boards avoid repeating cards within a draft when possible", () => {
  const cards = Array.from({ length: 100 }, (_, index) => boardCard(index + 1, index + 1));
  const state = draftState();
  const byTeam = new Map([["PIT", cards]]);

  const first = generateBoard({ byTeam, teams: ["PIT"], state, team: "PIT" });
  const second = generateBoard({ byTeam, teams: ["PIT"], state, team: "PIT" });
  const firstIds = new Set(first.board.map((item) => item.card_id));
  const repeated = second.board.filter((item) => firstIds.has(item.card_id));

  assert.equal(repeated.length, 0);
});

test("generated random boards avoid repeating franchises within a draft when possible", () => {
  const pitCards = Array.from({ length: 30 }, (_, index) => boardCard(index + 1, index + 1, "PIT"));
  const bosCards = Array.from({ length: 30 }, (_, index) => boardCard(index + 1, index + 1, "BOS"));
  const state = draftState();
  const byTeam = new Map([
    ["PIT", pitCards],
    ["BOS", bosCards],
  ]);

  const first = generateBoard({ byTeam, teams: ["PIT", "BOS"], state });
  const second = generateBoard({ byTeam, teams: ["PIT", "BOS"], state });

  assert.notEqual(second.franchiseKey, first.franchiseKey);
  assert.deepEqual(new Set([first.franchiseKey, second.franchiseKey]), state.shownFranchiseKeys);
});

test("different-team shuffle avoids every previously shown franchise when possible", () => {
  const state = {
    id: "draft-1",
    status: "drafting",
    roster: { C: [], W: [], D: [], G: [] },
    selectedPlayerIds: new Set(),
    shownCardIds: new Set(),
    shownFranchiseKeys: new Set(["PIT", "BOS"]),
    selectedCards: [],
    lifelines: {
      same_team_shuffle: 1,
      different_team_shuffle: 1,
      same_team_choose_position: 1,
      pick_two: 1,
      reveal_ratings: 1,
    },
    currentFranchiseKey: "BOS",
    currentBoard: [],
    boardPicksRemaining: 1,
    pickTwoActive: false,
    revealedBoardRatings: false,
  };
  const byTeam = new Map([
    ["PIT", Array.from({ length: 30 }, (_, index) => boardCard(index + 1, index + 1, "PIT"))],
    ["BOS", Array.from({ length: 30 }, (_, index) => boardCard(index + 1, index + 1, "BOS"))],
    ["NYR", Array.from({ length: 30 }, (_, index) => boardCard(index + 1, index + 1, "NYR"))],
  ]);

  useLifeline({
    state,
    type: "different_team_shuffle",
    byTeam,
    teams: ["PIT", "BOS", "NYR"],
  });

  assert.equal(state.currentFranchiseKey, "NYR");
});

test("strict position boards show only primary-position cards", () => {
  const cards = [
    positionedCard("center", "C", 20),
    positionedCard("lw", "LW", 15),
    positionedCard("rw", "RW", 14),
    positionedCard("d", "D", 13),
    ...Array.from({ length: 30 }, (_, index) => positionedCard(`extra-wing-${index}`, index % 2 === 0 ? "LW" : "RW", index + 1)),
  ];
  const state = draftState();

  const result = generateBoard({
    byTeam: new Map([["PIT", cards]]),
    teams: ["PIT"],
    state,
    team: "PIT",
    position: "W",
    strictBoardPosition: true,
  });

  assert.equal(result.board.every((item) => item.position === "LW" || item.position === "RW"), true);
});
