const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

function setToArray(value) {
  if (!value) return [];
  return Array.from(value);
}

function hydrateCard(cardById, cardId, assignedSlot = null) {
  const card = cardById.get(cardId);
  if (!card) throw new Error(`Unknown card id: ${cardId}`);
  return assignedSlot ? { ...card, assigned_slot: assignedSlot } : card;
}

function stateToTokenPayload(state, { now = new Date(), ttlMs = DRAFT_TTL_MS } = {}) {
  const createdAt = state.createdAt || new Date(now).toISOString();
  return {
    version: 1,
    draftRunId: state.id,
    ...(state.friendCode && { friendCode: state.friendCode }),
    status: state.status,
    pickNumber: state.pickNumber,
    roster: {
      C: state.roster.C.map((card) => card.card_id),
      W: state.roster.W.map((card) => card.card_id),
      D: state.roster.D.map((card) => card.card_id),
      G: state.roster.G.map((card) => card.card_id),
    },
    selectedCardIds: state.selectedCards.map((card) => card.card_id),
    selectedPlayerIds: setToArray(state.selectedPlayerIds),
    shownCardIds: setToArray(state.shownCardIds),
    shownFranchiseKeys: setToArray(state.shownFranchiseKeys),
    lifelines: { ...state.lifelines },
    currentFranchiseKey: state.currentFranchiseKey,
    currentBoardCardIds: state.currentBoard.map((card) => card.card_id),
    boardPicksRemaining: state.boardPicksRemaining,
    pickTwoActive: state.pickTwoActive,
    revealedBoardRatings: state.revealedBoardRatings,
    finalScore: state.finalScore,
    rawScore: state.rawScore,
    positionAdjustedScore: state.positionAdjustedScore,
    compatibilityBonusPct: state.compatibilityBonusPct,
    compatibilityBonusScore: state.compatibilityBonusScore,
    percentileBand: state.percentileBand,
    rings: state.rings,
    createdAt,
    completedAt: state.completedAt,
    expiresAt: state.expiresAt || new Date(new Date(now).getTime() + ttlMs).toISOString(),
    nonce: Number(state.nonce || 0),
  };
}

function validateTokenPayload(payload, cardById) {
  if (!payload || payload.version !== 1) throw new Error("Unsupported draft token version");
  if (!payload.draftRunId) throw new Error("Draft token is missing draftRunId");
  if (!["drafting", "complete"].includes(payload.status)) throw new Error("Draft token has invalid status");
  if (!payload.roster || typeof payload.roster !== "object") throw new Error("Draft token is missing roster");
  for (const slot of ["C", "W", "D", "G"]) {
    if (!Array.isArray(payload.roster[slot])) throw new Error(`Draft token roster is missing ${slot}`);
  }
  for (const field of ["selectedCardIds", "selectedPlayerIds", "shownCardIds", "shownFranchiseKeys", "currentBoardCardIds"]) {
    if (!Array.isArray(payload[field])) throw new Error(`Draft token is missing ${field}`);
  }
  for (const cardId of [...payload.selectedCardIds, ...payload.currentBoardCardIds]) {
    if (!cardById.has(cardId)) throw new Error(`Unknown card id: ${cardId}`);
  }
  const selected = new Set(payload.selectedCardIds);
  for (const ids of Object.values(payload.roster)) {
    for (const cardId of ids) {
      if (!selected.has(cardId)) throw new Error("Roster card is not selected");
      if (!cardById.has(cardId)) throw new Error(`Unknown card id: ${cardId}`);
    }
  }
}

function tokenPayloadToState(payload, cardById) {
  validateTokenPayload(payload, cardById);

  const assignedSlotByCardId = new Map();
  for (const [slot, ids] of Object.entries(payload.roster)) {
    for (const cardId of ids) assignedSlotByCardId.set(cardId, slot);
  }

  const selectedCards = payload.selectedCardIds.map((cardId) => (
    hydrateCard(cardById, cardId, assignedSlotByCardId.get(cardId))
  ));

  return {
    id: payload.draftRunId,
    friendCode: payload.friendCode,
    status: payload.status,
    pickNumber: payload.pickNumber,
    roster: {
      C: payload.roster.C.map((cardId) => hydrateCard(cardById, cardId, "C")),
      W: payload.roster.W.map((cardId) => hydrateCard(cardById, cardId, "W")),
      D: payload.roster.D.map((cardId) => hydrateCard(cardById, cardId, "D")),
      G: payload.roster.G.map((cardId) => hydrateCard(cardById, cardId, "G")),
    },
    selectedPlayerIds: new Set(payload.selectedPlayerIds),
    shownCardIds: new Set(payload.shownCardIds),
    shownFranchiseKeys: new Set(payload.shownFranchiseKeys),
    selectedCards,
    lifelines: { ...payload.lifelines },
    currentFranchiseKey: payload.currentFranchiseKey,
    currentBoard: payload.currentBoardCardIds.map((cardId) => hydrateCard(cardById, cardId)),
    boardPicksRemaining: payload.boardPicksRemaining,
    pickTwoActive: payload.pickTwoActive,
    revealedBoardRatings: payload.revealedBoardRatings,
    finalScore: payload.finalScore,
    rawScore: payload.rawScore,
    positionAdjustedScore: payload.positionAdjustedScore,
    compatibilityBonusPct: payload.compatibilityBonusPct,
    compatibilityBonusScore: payload.compatibilityBonusScore,
    compatibility: null,
    percentileBand: payload.percentileBand,
    rings: payload.rings,
    createdAt: payload.createdAt,
    completedAt: payload.completedAt,
    expiresAt: payload.expiresAt,
    nonce: Number(payload.nonce || 0),
  };
}

module.exports = {
  DRAFT_TTL_MS,
  stateToTokenPayload,
  tokenPayloadToState,
  validateTokenPayload,
};
