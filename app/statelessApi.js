const { randomInt } = require("node:crypto");
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

const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIEND_CODE_LENGTH = 8;
const FRIEND_CODE_PATTERN = new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_LENGTH}}$`);

function resolveFriendCode(code) {
  if (code === undefined) return undefined;
  if (code === null) {
    return Array.from({ length: FRIEND_CODE_LENGTH }, () => (
      FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)]
    )).join("");
  }

  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!FRIEND_CODE_PATTERN.test(normalized)) throw new Error("Enter a valid 8-character friend code.");
  return normalized;
}

function startDraftAction({ store, friendCode, secret = secretFromEnv(), now = new Date() }) {
  const state = startDraft({ ...store, friendCode: resolveFriendCode(friendCode) });
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
