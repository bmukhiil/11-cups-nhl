const test = require("node:test");
const assert = require("node:assert/strict");
const { startDraft } = require("../app/gameEngine");
const {
  stateToTokenPayload,
  tokenPayloadToState,
  validateTokenPayload,
} = require("../app/statelessDraftState");

function card(id, team = "PIT", playerId = id) {
  return {
    card_id: id,
    player_id: playerId,
    player_name: `Player ${id}`,
    franchise_key: team,
    historical_team: team,
    position: "C",
    position_group: "F",
    card_type: "peak",
    card_label: "2020-21",
    selected_seasons: "2020-21",
    games_played_total: 82,
    raw_card_ps: 10,
    raw_card_ops: 9,
    raw_card_dps: 1,
    raw_card_gps: "",
  };
}

function store() {
  const cards = Array.from({ length: 30 }, (_, index) => card(`card-${index + 1}`));
  return {
    cards,
    cardById: new Map(cards.map((item) => [item.card_id, item])),
    byTeam: new Map([["PIT", cards]]),
    teams: ["PIT"],
  };
}

test("stateless payload stores ids and rehydrates engine state", () => {
  const testStore = store();
  const state = startDraft(testStore);
  const selected = state.currentBoard.find((candidate) => candidate.position === "C");
  state.roster.C.push({ ...selected, assigned_slot: "C" });
  state.selectedCards.push({ ...selected, assigned_slot: "C" });
  state.selectedPlayerIds.add(selected.player_id);

  const payload = stateToTokenPayload(state, { now: new Date("2026-01-01T00:00:00.000Z") });
  const rehydrated = tokenPayloadToState(payload, testStore.cardById);

  assert.equal(payload.currentBoardCardIds.length, 10);
  assert.equal(payload.currentBoardCardIds[0], state.currentBoard[0].card_id);
  assert.equal(payload.roster.C[0], selected.card_id);
  assert.equal(rehydrated.roster.C[0].card_id, selected.card_id);
  assert.equal(rehydrated.roster.C[0].assigned_slot, "C");
  assert.equal(rehydrated.currentBoard.length, state.currentBoard.length);
  assert.equal(rehydrated.shownCardIds.has(state.currentBoard[0].card_id), true);
  assert.equal(rehydrated.shownFranchiseKeys.has("PIT"), true);
});

test("stateless payload rejects missing board cards", () => {
  const testStore = store();
  const state = startDraft(testStore);
  const payload = stateToTokenPayload(state);
  payload.currentBoardCardIds = ["missing-card"];

  assert.throws(
    () => validateTokenPayload(payload, testStore.cardById),
    /Unknown card id/,
  );
});

test("stateless payload rejects roster cards not selected", () => {
  const testStore = store();
  const state = startDraft(testStore);
  const payload = stateToTokenPayload(state);
  payload.roster.C = [state.currentBoard[0].card_id];

  assert.throws(
    () => validateTokenPayload(payload, testStore.cardById),
    /Roster card is not selected/,
  );
});
