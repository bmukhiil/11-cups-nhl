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

test("four friend drafts share regular boards after different picks and a reshuffle", () => {
  const store = loadCardStore();
  const secret = SECRET;
  const code = "CUPSDRFT";
  const players = Array.from({ length: 4 }, () => (
    startDraftAction({ store, secret, friendCode: ` ${code.toLowerCase()} ` })
  ));
  const [host, ...joined] = players;
  const boardIds = (player) => player.draft.board.map((card) => card.cardId);
  assert.equal(new Set(players.map((player) => player.draft.draftRunId)).size, 4);
  for (const player of joined) {
    assert.equal(player.draft.currentFranchiseKey, host.draft.currentFranchiseKey);
    assert.deepEqual(boardIds(player), boardIds(host));
  }

  const next = players.map((player, index) => (
    selectCardAction({ store, secret, draftToken: player.draftToken, cardId: boardIds(player)[index] })
  ));
  assert.equal(new Set(next.map((player) => player.selectedCard.cardId)).size, 4);
  for (const player of next) {
    assert.equal(player.draft.friendCode, code);
    assert.equal(player.draft.currentFranchiseKey, next[0].draft.currentFranchiseKey);
    assert.deepEqual(boardIds(player), boardIds(next[0]));
  }

  next[0] = useLifelineAction({
    store, secret, draftToken: next[0].draftToken, type: "same_team_shuffle",
  });
  assert.equal(next[0].draft.lifelines.same_team_shuffle, 0);
  assert.equal(next[1].draft.lifelines.same_team_shuffle, 1);
  const third = next.map((player) => selectCardAction({
    store, secret, draftToken: player.draftToken,
    cardId: player.draft.board.find((card) => card.selectable).cardId,
  }));
  for (const player of third) {
    assert.equal(player.draft.pickNumber, 3);
    assert.equal(player.draft.currentFranchiseKey, third[0].draft.currentFranchiseKey);
    assert.deepEqual(boardIds(player), boardIds(third[0]));
  }
});

test("start rejects malformed friend codes", () => {
  const store = loadCardStore();
  for (const friendCode of ["", "AAAAAAA0", "TOO-LONG-123", false]) {
    assert.throws(
      () => startDraftAction({ store, friendCode, secret: SECRET }),
      /valid 8-character friend code/,
    );
  }
});

test("creating a friend code produces an invite that replays the opening board", () => {
  const store = loadCardStore();
  const host = startDraftAction({ store, secret: SECRET, friendCode: null }).draft;
  assert.match(host.friendCode, /^[A-HJ-NP-Z2-9]{8}$/);
  const guest = startDraftAction({ store, secret: SECRET, friendCode: host.friendCode }).draft;
  assert.equal(guest.currentFranchiseKey, host.currentFranchiseKey);
  assert.deepEqual(guest.board, host.board);
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
