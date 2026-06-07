const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCardStore } = require("../app/cardStore");
const {
  selectCardAction,
  startDraftAction,
  useLifelineAction,
} = require("../app/statelessApi");

const SECRET = "12345678901234567890123456789012";

test("stateless start returns token and public draft", () => {
  const store = loadCardStore();
  const result = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });

  assert.equal(typeof result.draftToken, "string");
  assert.equal(result.draft.status, "drafting");
  assert.equal(result.draft.board.length, 10);
  assert.equal(result.draft.board[0].rawCardPs, undefined);
});

test("stateless select returns a new token and selected card reveal", () => {
  const store = loadCardStore();
  const started = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });
  const pick = started.draft.board.find((card) => card.selectable);
  const selected = selectCardAction({
    store,
    secret: SECRET,
    now: new Date("2026-01-01T00:01:00.000Z"),
    draftToken: started.draftToken,
    cardId: pick.cardId,
  });

  assert.equal(typeof selected.draftToken, "string");
  assert.notEqual(selected.draftToken, started.draftToken);
  assert.equal(selected.selectedCard.cardId, pick.cardId);
  assert.equal(typeof selected.selectedCard.rawCardPs, "number");
  assert.equal(selected.draft.pickNumber, 2);
});

test("stateless action rejects tampered token", () => {
  const store = loadCardStore();
  const started = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });
  const pick = started.draft.board.find((card) => card.selectable);

  assert.throws(
    () => selectCardAction({
      store,
      secret: SECRET,
      now: new Date("2026-01-01T00:01:00.000Z"),
      draftToken: `${started.draftToken}x`,
      cardId: pick.cardId,
    }),
    /Invalid draft token signature/,
  );
});

test("stateless action rejects off-board card", () => {
  const store = loadCardStore();
  const started = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });
  const offBoard = store.cards.find((card) => !started.draft.board.some((boardCard) => boardCard.cardId === card.card_id));

  assert.throws(
    () => selectCardAction({
      store,
      secret: SECRET,
      now: new Date("2026-01-01T00:01:00.000Z"),
      draftToken: started.draftToken,
      cardId: offBoard.card_id,
    }),
    /not on the current board/,
  );
});

test("stateless lifeline returns next signed state and reveals board ratings", () => {
  const store = loadCardStore();
  const started = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });
  const revealed = useLifelineAction({
    store,
    secret: SECRET,
    now: new Date("2026-01-01T00:01:00.000Z"),
    draftToken: started.draftToken,
    type: "reveal_ratings",
  });

  assert.equal(typeof revealed.draftToken, "string");
  assert.equal(revealed.draft.revealedBoardRatings, true);
  assert.equal(typeof revealed.draft.board[0].rawCardPs, "number");
});

test("stateless lifeline cannot be used twice from returned token", () => {
  const store = loadCardStore();
  const started = startDraftAction({ store, secret: SECRET, now: new Date("2026-01-01T00:00:00.000Z") });
  const first = useLifelineAction({
    store,
    secret: SECRET,
    now: new Date("2026-01-01T00:01:00.000Z"),
    draftToken: started.draftToken,
    type: "reveal_ratings",
  });

  assert.throws(
    () => useLifelineAction({
      store,
      secret: SECRET,
      now: new Date("2026-01-01T00:02:00.000Z"),
      draftToken: first.draftToken,
      type: "reveal_ratings",
    }),
    /already used/,
  );
});
