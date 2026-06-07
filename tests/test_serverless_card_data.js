const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCardData } = require("../scripts/build_serverless_card_data");
const { rowsToStore } = require("../app/cardStore");

test("serverless card data includes compact team indexes", () => {
  const data = buildCardData("data/team_board_pools_hockey_reference_enriched.csv");
  const cardIds = new Set(data.cards.map((card) => card.card_id));

  assert.equal(data.cardCount, data.cards.length);
  assert.equal(data.teamCount, data.teams.length);
  assert.equal(data.cardCount > 3000, true);
  assert.equal(data.teamCount, 32);

  for (const [team, ids] of Object.entries(data.byTeam)) {
    assert.equal(data.teams.includes(team), true);
    assert.equal(ids.length > 0, true);
    for (const id of ids) assert.equal(cardIds.has(id), true);
  }
});

test("card store rehydrates generated cards into lookup maps", () => {
  const data = buildCardData("data/team_board_pools_hockey_reference_enriched.csv");
  const store = rowsToStore(data.cards, "test");

  assert.equal(store.cards.length, data.cardCount);
  assert.equal(store.teams.length, 32);
  assert.equal(store.cardById.get(data.cards[0].card_id).card_id, data.cards[0].card_id);
  assert.equal(Array.isArray(store.byTeam.get(data.cards[0].franchise_key)), true);
  assert.equal(typeof store.cards[0].raw_card_ps, "number");
});

test("serverless card data attaches local headshot metadata when assets exist", () => {
  const data = buildCardData("data/team_board_pools_hockey_reference_enriched.csv");
  const cardsWithNhlIds = data.cards.filter((card) => card.nhl_player_id);
  const cardsWithHeadshots = data.cards.filter((card) => card.headshot_url);

  assert.equal(cardsWithNhlIds.length > 3000, true);
  assert.equal(cardsWithHeadshots.every((card) => card.headshot_url.startsWith("/")), true);
  assert.equal(cardsWithHeadshots.every((card) => ["nhl", "hockey_reference"].includes(card.headshot_source)), true);
});
