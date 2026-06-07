const {
  selectCard,
  startDraft,
  stateResponse,
  useLifeline,
} = require("./gameEngine");
const {
  stateToTokenPayload,
  tokenPayloadToState,
} = require("./statelessDraftState");
const {
  signDraftPayload,
  verifyDraftToken,
} = require("./security/draftToken");

function secretFromEnv(secret) {
  return secret || process.env.DRAFT_STATE_SECRET;
}

function responseForState(state, secret, options = {}) {
  const payload = stateToTokenPayload(state, options);
  const draftToken = signDraftPayload(payload, secret, options);
  return {
    draftToken,
    draft: stateResponse(state),
  };
}

function startDraftAction({ store, secret = secretFromEnv(), now = new Date() }) {
  const state = startDraft(store);
  state.expiresAt = new Date(new Date(now).getTime() + 2 * 60 * 60 * 1000).toISOString();
  return responseForState(state, secret, { now });
}

function stateFromToken({ draftToken, store, secret = secretFromEnv(), now = new Date() }) {
  const payload = verifyDraftToken(draftToken, secret, { now });
  return tokenPayloadToState(payload, store.cardById);
}

function selectCardAction({ store, secret = secretFromEnv(), now = new Date(), draftToken, cardId }) {
  if (!cardId || typeof cardId !== "string") throw new Error("cardId is required");
  const state = stateFromToken({ draftToken, store, secret, now });
  const result = selectCard({
    state,
    cardId,
    ...store,
  });
  result.state.nonce = Number(result.state.nonce || 0) + 1;
  return {
    selectedCard: result.selectedCard,
    ...responseForState(result.state, secret, { now }),
  };
}

function useLifelineAction({ store, secret = secretFromEnv(), now = new Date(), draftToken, type, position }) {
  if (!type || typeof type !== "string") throw new Error("type is required");
  const state = stateFromToken({ draftToken, store, secret, now });
  const updated = useLifeline({
    state,
    type,
    position,
    ...store,
  });
  updated.nonce = Number(updated.nonce || 0) + 1;
  return responseForState(updated, secret, { now });
}

module.exports = {
  responseForState,
  selectCardAction,
  startDraftAction,
  stateFromToken,
  useLifelineAction,
};
