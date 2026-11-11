const crypto = require("node:crypto");

const ROSTER_LIMITS = {
  C: 2,
  W: 2,
  D: 2,
  G: 1,
};

const LIFELINE_LIMITS = {
  same_team_shuffle: 1,
  different_team_shuffle: 1,
  same_team_choose_position: 1,
  pick_two: 1,
  reveal_ratings: 1,
};

const RING_THRESHOLDS = [
  { rings: 6, score: 95, percentile: 98 },
  { rings: 5, score: 90, percentile: 93 },
  { rings: 4, score: 85, percentile: 85 },
  { rings: 3, score: 80, percentile: 75 },
  { rings: 2, score: 75, percentile: 65 },
  { rings: 1, score: 70, percentile: 50 },
  { rings: 0, score: 0, percentile: 0 },
];

const POSITION_FIT_MODIFIERS = {
  natural: 1,
  center_to_wing: 0.8,
  wing_to_center: 0.7,
};

const HANDEDNESS_BONUSES = {
  C: 0.015,
  W: 0.015,
  D: 0.02,
};

const BOARD_SIZE = 10;

const BOARD_BUCKET_RANGES = {
  high: { min: 1, max: 3 },
  mid: { min: 4, max: 6 },
  low: { min: 2, max: 4 },
};

function normalizeSlot(card) {
  const position = String(card.position || "").toUpperCase();
  if (position === "G") return "G";
  if (position === "D") return "D";
  if (position === "C") return "C";
  return "W";
}

function normalizePosition(card) {
  return String(card.position || "").toUpperCase();
}

function normalizeHandedness(card) {
  const value = String(card.shoots || card.catches || card.handedness || "").trim().toUpperCase();
  if (value === "L" || value === "LEFT") return "L";
  if (value === "R" || value === "RIGHT") return "R";
  return "unknown";
}

function emptyRoster() {
  return { C: [], W: [], D: [], G: [] };
}

function rosterCount(roster) {
  return Object.values(roster).reduce((sum, cards) => sum + cards.length, 0);
}

function canFitRoster(card, roster) {
  return assignmentOptions(card, roster).length > 0;
}

function canPlaySlot(card, slot) {
  const naturalSlot = normalizeSlot(card);
  if (naturalSlot === slot) return true;
  if (naturalSlot === "C" && slot === "W") return true;
  if (naturalSlot === "W" && slot === "C") return true;
  return false;
}

function primarySlot(card) {
  return normalizeSlot(card);
}

function assignmentOptions(card, roster) {
  const naturalSlot = normalizeSlot(card);
  const options = [];
  if (roster[naturalSlot].length < ROSTER_LIMITS[naturalSlot]) {
    options.push(naturalSlot);
  }
  if (naturalSlot === "C" && roster.W.length < ROSTER_LIMITS.W) {
    options.push("W");
  }
  if (naturalSlot === "W" && roster.C.length < ROSTER_LIMITS.C) {
    options.push("C");
  }
  return options;
}

function assignSlot(card, roster) {
  const options = assignmentOptions(card, roster);
  if (options.length === 0) return null;
  return options[0];
}

function positionFit(card) {
  const naturalSlot = normalizeSlot(card);
  const assignedSlot = card.assigned_slot || naturalSlot;
  if (naturalSlot === assignedSlot) {
    return { key: "natural", label: "Natural fit", modifier: POSITION_FIT_MODIFIERS.natural };
  }
  if (naturalSlot === "C" && assignedSlot === "W") {
    return { key: "center_to_wing", label: "Center playing wing", modifier: POSITION_FIT_MODIFIERS.center_to_wing };
  }
  if (naturalSlot === "W" && assignedSlot === "C") {
    return { key: "wing_to_center", label: "Wing playing center", modifier: POSITION_FIT_MODIFIERS.wing_to_center };
  }
  return { key: "invalid", label: "Invalid fit", modifier: 0 };
}

function publicBoardCard(card, state) {
  const disabledReason = disabledReasonForCard(card, state);
  const publicCard = {
    cardId: card.card_id,
    playerId: card.player_id,
    nhlPlayerId: card.nhl_player_id || "",
    headshotUrl: card.headshot_url || "",
    headshotSource: card.headshot_source || "",
    playerName: card.player_name,
    franchiseKey: card.franchise_key,
    historicalTeam: card.historical_team,
    position: card.position,
    positionGroup: card.position_group,
    naturalSlot: normalizeSlot(card),
    shoots: normalizeHandedness(card),
    cardType: card.card_type,
    cardLabel: card.card_label,
    selectedSeasons: card.selected_seasons,
    selectable: disabledReason === null,
    disabledReason,
  };
  if (state.revealedBoardRatings) {
    publicCard.rawCardPs = Number(card.raw_card_ps);
    publicCard.rawCardOps = card.raw_card_ops === "" ? null : Number(card.raw_card_ops);
    publicCard.rawCardDps = card.raw_card_dps === "" ? null : Number(card.raw_card_dps);
    publicCard.rawCardGps = card.raw_card_gps === "" ? null : Number(card.raw_card_gps);
  }
  return publicCard;
}

function revealedCard(card) {
  return {
    cardId: card.card_id,
    playerId: card.player_id,
    nhlPlayerId: card.nhl_player_id || "",
    headshotUrl: card.headshot_url || "",
    headshotSource: card.headshot_source || "",
    playerName: card.player_name,
    franchiseKey: card.franchise_key,
    historicalTeam: card.historical_team,
    position: card.position,
    positionGroup: card.position_group,
    naturalSlot: normalizeSlot(card),
    assignedSlot: card.assigned_slot || normalizeSlot(card),
    shoots: normalizeHandedness(card),
    cardType: card.card_type,
    cardLabel: card.card_label,
    selectedSeasons: card.selected_seasons,
    gamesPlayed: Number(card.games_played_total),
    rawCardPs: Number(card.raw_card_ps),
    rawCardOps: card.raw_card_ops === "" ? null : Number(card.raw_card_ops),
    rawCardDps: card.raw_card_dps === "" ? null : Number(card.raw_card_dps),
    rawCardGps: card.raw_card_gps === "" ? null : Number(card.raw_card_gps),
    positionFit: positionFit(card),
    adjustedCardScore: Number((Number(card.raw_card_ps) * positionFit(card).modifier).toFixed(3)),
  };
}

function disabledReasonForCard(card, state) {
  if (state.selectedPlayerIds.has(card.player_id)) return "duplicate_player";
  if (!canFitRoster(card, state.roster)) return "position_full";
  return null;
}

function seededRandom(seed) {
  let draw = 0;
  return (max) => {
    const hash = crypto.createHash("sha256").update(`${seed}:${draw++}`).digest();
    return Math.floor(hash.readUInt32BE(0) / 0x100000000 * max);
  };
}

function sampleCards(cards, size, randomInt) {
  const pool = [...cards];
  const selected = [];
  while (pool.length > 0 && selected.length < size) {
    const index = randomInt(pool.length);
    selected.push(pool[index]);
    pool.splice(index, 1);
  }
  return selected;
}

function shuffle(items, randomInt) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function cardScore(card) {
  return Number(card.raw_card_ps);
}

function quantile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function boardComposition(size, randomInt) {
  const valid = [];
  for (let high = BOARD_BUCKET_RANGES.high.min; high <= BOARD_BUCKET_RANGES.high.max; high += 1) {
    for (let low = BOARD_BUCKET_RANGES.low.min; low <= BOARD_BUCKET_RANGES.low.max; low += 1) {
      const mid = size - high - low;
      if (mid >= BOARD_BUCKET_RANGES.mid.min && mid <= BOARD_BUCKET_RANGES.mid.max) {
        valid.push({ high, mid, low });
      }
    }
  }
  return valid[randomInt(valid.length)];
}

function bucketedCards(cards) {
  const scores = cards.map(cardScore).filter(Number.isFinite);
  const highFloor = quantile(scores, 75);
  const lowCeiling = quantile(scores, 35);
  const buckets = { high: [], mid: [], low: [] };
  for (const card of cards) {
    const score = cardScore(card);
    if (score >= highFloor) {
      buckets.high.push(card);
    } else if (score <= lowCeiling) {
      buckets.low.push(card);
    } else {
      buckets.mid.push(card);
    }
  }
  return buckets;
}

function takeFromBucket(bucket, count, selectedIds, randomInt) {
  const available = bucket.filter((card) => !selectedIds.has(card.card_id));
  const sampled = sampleCards(available, count, randomInt);
  for (const card of sampled) selectedIds.add(card.card_id);
  return sampled;
}

function sampleBucketedBoard(pool, size, randomInt) {
  if (pool.length <= size) return shuffle(pool, randomInt);
  const buckets = bucketedCards(pool);
  const composition = boardComposition(size, randomInt);
  const selectedIds = new Set();
  const selected = [
    ...takeFromBucket(buckets.high, composition.high, selectedIds, randomInt),
    ...takeFromBucket(buckets.mid, composition.mid, selectedIds, randomInt),
    ...takeFromBucket(buckets.low, composition.low, selectedIds, randomInt),
  ];

  if (selected.length < size) {
    const fallbackOrder = [
      ...buckets.mid,
      ...buckets.high,
      ...buckets.low,
      ...pool,
    ];
    const remaining = fallbackOrder.filter((card) => !selectedIds.has(card.card_id));
    selected.push(...sampleCards(remaining, size - selected.length, randomInt));
  }

  return shuffle(selected, randomInt).slice(0, size);
}

function markBoardShown(state, franchiseKey, board) {
  if (!state.shownCardIds) state.shownCardIds = new Set();
  for (const card of board) state.shownCardIds.add(card.card_id);
  if (!state.shownFranchiseKeys) state.shownFranchiseKeys = new Set();
  state.shownFranchiseKeys.add(franchiseKey);
}

function randomTeam(teams, excludedTeams = null, randomInt = crypto.randomInt) {
  const excluded = excludedTeams instanceof Set
    ? excludedTeams
    : new Set(Array.isArray(excludedTeams) ? excludedTeams : [excludedTeams].filter(Boolean));
  const eligible = excluded.size > 0 && teams.length > excluded.size
    ? teams.filter((team) => !excluded.has(team))
    : teams;
  return eligible[randomInt(eligible.length)];
}

function selectableCards(board, state) {
  return board.filter((card) => disabledReasonForCard(card, state) === null);
}

function generateBoard({
  byTeam, teams, state, team = null, position = null, strictBoardPosition = false,
  size = BOARD_SIZE, randomInt = crypto.randomInt,
}) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const franchiseKey = team || randomTeam(teams, state.shownFranchiseKeys, randomInt);
    let pool = byTeam.get(franchiseKey) || [];
    if (position) {
      pool = pool.filter((card) => (
        strictBoardPosition
          ? primarySlot(card) === position
          : canPlaySlot(card, position)
      ));
    }
    let unseenPool = pool.filter((card) => !state.shownCardIds?.has(card.card_id));
    if (unseenPool.length < size) unseenPool = pool;
    const board = sampleBucketedBoard(unseenPool, size, randomInt);
    if (selectableCards(board, state).length > 0) {
      markBoardShown(state, franchiseKey, board);
      return { franchiseKey, board };
    }
  }
  throw new Error("Unable to generate a selectable board");
}

function generateRegularBoard({ byTeam, teams, state }) {
  if (!state.friendCode) return generateBoard({ byTeam, teams, state });

  // Picks and wild cards never change the shared franchise schedule or card pool.
  const order = shuffle(teams, seededRandom(`friends:v1:${state.friendCode}:teams`));
  const franchiseKey = order[(state.pickNumber - 1) % order.length];
  const seed = `friends:v1:${state.friendCode}:pick:${state.pickNumber}`;
  const board = sampleBucketedBoard(byTeam.get(franchiseKey), BOARD_SIZE, seededRandom(seed));
  if (selectableCards(board, state).length === 0) {
    // Choose a franchise with a legal pick before drawing a personal fallback.
    const eligibleTeams = teams.filter((team) => selectableCards(byTeam.get(team), state).length > 0);
    if (eligibleTeams.length === 0) throw new Error("Unable to generate a selectable board");
    const randomInt = seededRandom(`${seed}:fallback`);
    const fallbackTeam = randomTeam(eligibleTeams, state.shownFranchiseKeys, randomInt);
    const pool = byTeam.get(fallbackTeam);
    const fallback = sampleBucketedBoard(pool, BOARD_SIZE, randomInt);
    if (selectableCards(fallback, state).length === 0) {
      const legal = selectableCards(pool, state);
      fallback[fallback.length - 1] = legal[randomInt(legal.length)];
    }
    markBoardShown(state, fallbackTeam, fallback);
    return { franchiseKey: fallbackTeam, board: fallback };
  }
  markBoardShown(state, franchiseKey, board);
  return { franchiseKey, board };
}

function startDraft({ byTeam, teams, friendCode }) {
  const state = {
    id: crypto.randomUUID(),
    friendCode,
    status: "drafting",
    pickNumber: 1,
    roster: emptyRoster(),
    selectedPlayerIds: new Set(),
    shownCardIds: new Set(),
    shownFranchiseKeys: new Set(),
    selectedCards: [],
    lifelines: { ...LIFELINE_LIMITS },
    currentFranchiseKey: null,
    currentBoard: [],
    boardPicksRemaining: 1,
    pickTwoActive: false,
    revealedBoardRatings: false,
    finalScore: null,
    rawScore: null,
    positionAdjustedScore: null,
    compatibilityBonusPct: null,
    compatibilityBonusScore: null,
    compatibility: null,
    percentileBand: null,
    rings: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  const { franchiseKey, board } = generateRegularBoard({ byTeam, teams, state });
  state.currentFranchiseKey = franchiseKey;
  state.currentBoard = board;
  return state;
}

function stateResponse(state) {
  return {
    draftRunId: state.id,
    ...(state.friendCode && { friendCode: state.friendCode }),
    status: state.status,
    pickNumber: state.pickNumber,
    currentFranchiseKey: state.currentFranchiseKey,
    roster: {
      C: state.roster.C.map(revealedCard),
      W: state.roster.W.map(revealedCard),
      D: state.roster.D.map(revealedCard),
      G: state.roster.G.map(revealedCard),
    },
    lifelines: state.lifelines,
    boardPicksRemaining: state.boardPicksRemaining,
    pickTwoActive: state.pickTwoActive,
    revealedBoardRatings: state.revealedBoardRatings,
    board: state.currentBoard.map((card) => publicBoardCard(card, state)),
    finalScore: state.finalScore,
    rawScore: state.rawScore,
    positionAdjustedScore: state.positionAdjustedScore,
    compatibilityBonusPct: state.compatibilityBonusPct,
    compatibilityBonusScore: state.compatibilityBonusScore,
    compatibility: state.compatibility,
    percentileBand: state.percentileBand,
    rings: state.rings,
  };
}

function handednessBonusForSlot(roster, slot) {
  const values = slot === "W"
    ? roster[slot].map(normalizePosition)
    : roster[slot].map(normalizeHandedness);
  const hasLeft = slot === "W" ? values.includes("LW") : values.includes("L");
  const hasRight = slot === "W" ? values.includes("RW") : values.includes("R");
  const completePair = roster[slot].length === ROSTER_LIMITS[slot] && ROSTER_LIMITS[slot] === 2;
  const earned = completePair && hasLeft && hasRight;
  return {
    slot,
    label: slot === "C" ? "Center handedness balance" : slot === "W" ? "Wing side balance" : "Defense handedness balance",
    hands: values,
    bonusPct: earned ? HANDEDNESS_BONUSES[slot] : 0,
    earned,
  };
}

function compatibilityForDraft(state) {
  const positionFits = state.selectedCards.map((card) => {
    const fit = positionFit(card);
    const rawScore = Number(card.raw_card_ps);
    return {
      cardId: card.card_id,
      playerName: card.player_name,
      naturalSlot: normalizeSlot(card),
      assignedSlot: card.assigned_slot || normalizeSlot(card),
      fitKey: fit.key,
      fitLabel: fit.label,
      modifier: fit.modifier,
      rawScore: Number(rawScore.toFixed(3)),
      adjustedScore: Number((rawScore * fit.modifier).toFixed(3)),
    };
  });
  const handednessBonuses = ["C", "W", "D"].map((slot) => handednessBonusForSlot(state.roster, slot));
  const rawScore = Number(positionFits.reduce((sum, item) => sum + item.rawScore, 0).toFixed(3));
  const positionAdjustedScore = Number(positionFits.reduce((sum, item) => sum + item.adjustedScore, 0).toFixed(3));
  const compatibilityBonusPct = Number(handednessBonuses.reduce((sum, item) => sum + item.bonusPct, 0).toFixed(3));
  const compatibilityBonusScore = Number((positionAdjustedScore * compatibilityBonusPct).toFixed(3));
  const finalScore = Number((positionAdjustedScore + compatibilityBonusScore).toFixed(3));
  return {
    rawScore,
    positionAdjustedScore,
    compatibilityBonusPct,
    compatibilityBonusScore,
    finalScore,
    positionFits,
    handednessBonuses,
  };
}

function scoreDraft(state) {
  const compatibility = compatibilityForDraft(state);
  const finalScore = compatibility.finalScore;
  const threshold = RING_THRESHOLDS.find((item) => finalScore >= item.score) || RING_THRESHOLDS[RING_THRESHOLDS.length - 1];
  state.finalScore = finalScore;
  state.rawScore = compatibility.rawScore;
  state.positionAdjustedScore = compatibility.positionAdjustedScore;
  state.compatibilityBonusPct = compatibility.compatibilityBonusPct;
  state.compatibilityBonusScore = compatibility.compatibilityBonusScore;
  state.compatibility = compatibility;
  state.percentileBand = threshold.percentile;
  state.rings = threshold.rings;
  state.status = "complete";
  state.completedAt = new Date().toISOString();
}

function selectCard({ state, cardId, byTeam, teams }) {
  if (state.status !== "drafting") throw new Error("Draft is already complete");
  const card = state.currentBoard.find((candidate) => candidate.card_id === cardId);
  if (!card) throw new Error("Card is not on the current board");
  const disabledReason = disabledReasonForCard(card, state);
  if (disabledReason) throw new Error(`Card cannot be selected: ${disabledReason}`);

  const slot = assignSlot(card, state.roster);
  if (!slot) throw new Error("Card cannot be assigned to the roster");
  const selected = { ...card, assigned_slot: slot };
  state.roster[slot].push(selected);
  state.selectedCards.push(selected);
  state.selectedPlayerIds.add(selected.player_id);

  const selectedCard = revealedCard(selected);
  if (rosterCount(state.roster) >= 7) {
    state.currentBoard = [];
    state.boardPicksRemaining = 0;
    state.pickTwoActive = false;
    scoreDraft(state);
    return { selectedCard, state };
  }

  state.pickNumber += 1;
  if (state.boardPicksRemaining > 1
    && (!state.friendCode || selectableCards(state.currentBoard, state).length > 0)) {
    state.boardPicksRemaining -= 1;
    return { selectedCard, state };
  }

  const nextBoard = generateRegularBoard({ byTeam, teams, state });
  state.currentFranchiseKey = nextBoard.franchiseKey;
  state.currentBoard = nextBoard.board;
  state.boardPicksRemaining = 1;
  state.pickTwoActive = false;
  state.revealedBoardRatings = false;
  return { selectedCard, state };
}

function useLifeline({ state, type, position, byTeam, teams }) {
  if (state.status !== "drafting") throw new Error("Draft is already complete");
  if (!Object.prototype.hasOwnProperty.call(state.lifelines, type)) throw new Error("Unknown lifeline");
  if (state.lifelines[type] <= 0) throw new Error("Lifeline already used");

  let boardResult;
  if (type === "same_team_shuffle") {
    boardResult = generateBoard({ byTeam, teams, state, team: state.currentFranchiseKey });
  } else if (type === "different_team_shuffle") {
    const excludedTeams = new Set([state.currentFranchiseKey, ...state.shownFranchiseKeys]);
    const team = randomTeam(teams, excludedTeams);
    boardResult = generateBoard({ byTeam, teams, state, team });
  } else if (type === "same_team_choose_position") {
    if (!["C", "W", "D", "G"].includes(position)) throw new Error("Position is required for this lifeline");
    if (state.roster[position].length >= ROSTER_LIMITS[position]) throw new Error("Chosen position is already full");
    const strictBoardPosition = true;
    boardResult = generateBoard({ byTeam, teams, state, team: state.currentFranchiseKey, position, strictBoardPosition });
  } else if (type === "pick_two") {
    state.boardPicksRemaining = Math.max(state.boardPicksRemaining, 2);
    state.pickTwoActive = true;
  } else if (type === "reveal_ratings") {
    state.revealedBoardRatings = true;
  }

  state.lifelines[type] -= 1;
  if (boardResult) {
    state.currentFranchiseKey = boardResult.franchiseKey;
    state.currentBoard = boardResult.board;
    state.revealedBoardRatings = false;
  }
  return state;
}

module.exports = {
  RING_THRESHOLDS,
  ROSTER_LIMITS,
  compatibilityForDraft,
  generateBoard,
  normalizeSlot,
  revealedCard,
  selectCard,
  startDraft,
  stateResponse,
  useLifeline,
};
