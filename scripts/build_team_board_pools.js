const path = require("node:path");
const {
  GAME_VALUE_COLUMNS,
  assertColumns,
  numeric,
  readCsv,
  writeCsv,
} = require("./pipeline_common");

const TEAM_BOARD_POOL_COLUMNS = [
  "franchise_key",
  "board_pool_slot",
  "board_card_id",
  "source_pool",
  "selection_type",
  "draw_weight",
  "era_bucket",
  "era_weight",
  "rating_weight",
  "player_id",
  "player_name",
  "season_id",
  "season_label",
  "team",
  "position",
  "position_group",
  "player_type",
  "games_played",
  "season_score",
  "adjusted_season_score",
  "rating_group",
  "rating",
  "salary",
  "game_points",
  "source",
  "historical_team",
  "team_name",
  "franchise_name",
  "current_team",
  "franchise_status",
];

function parseArgs(argv) {
  const args = {
    primaryInput: path.join("data", "game_subset_player_seasons_enriched.csv"),
    backupInput: path.join("data", "player_game_values.csv"),
    franchiseMap: path.join("data", "franchise_map.csv"),
    output: path.join("data", "team_board_pools.csv"),
    slotsPerTeam: 100,
    primaryMinRating: 60,
    backupMinRating: 30,
    emergencyMinRating: 0,
    forcedTopCards: 25,
    minSkaterGames: 70,
    minGoalieGames: 40,
    maxSlotsPerPlayer: 8,
    maxSlotsPerCard: 4,
    seed: 110011,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--primary-input") {
      args.primaryInput = value;
      i += 1;
    } else if (arg === "--backup-input") {
      args.backupInput = value;
      i += 1;
    } else if (arg === "--franchise-map") {
      args.franchiseMap = value;
      i += 1;
    } else if (arg === "--output") {
      args.output = value;
      i += 1;
    } else if (arg === "--slots-per-team") {
      args.slotsPerTeam = Number(value);
      i += 1;
    } else if (arg === "--primary-min-rating") {
      args.primaryMinRating = Number(value);
      i += 1;
    } else if (arg === "--backup-min-rating") {
      args.backupMinRating = Number(value);
      i += 1;
    } else if (arg === "--emergency-min-rating") {
      args.emergencyMinRating = Number(value);
      i += 1;
    } else if (arg === "--forced-top-cards") {
      args.forcedTopCards = Number(value);
      i += 1;
    } else if (arg === "--min-skater-games") {
      args.minSkaterGames = Number(value);
      i += 1;
    } else if (arg === "--min-goalie-games") {
      args.minGoalieGames = Number(value);
      i += 1;
    } else if (arg === "--max-slots-per-player") {
      args.maxSlotsPerPlayer = Number(value);
      i += 1;
    } else if (arg === "--max-slots-per-card") {
      args.maxSlotsPerCard = Number(value);
      i += 1;
    } else if (arg === "--seed") {
      args.seed = Number(value);
      i += 1;
    }
  }
  return args;
}

function cardId(row) {
  return `${row.player_id}-${row.season_id}-${row.team}`;
}

function seasonStart(row) {
  return Number(String(row.season_id).slice(0, 4));
}

function eraBucket(row) {
  const year = seasonStart(row);
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  if (year >= 1990) return "1990s";
  if (year >= 1980) return "1980s";
  if (year >= 1970) return "1970s";
  if (year >= 1960) return "1960s";
  return "pre1960";
}

function eraWeight(bucket) {
  return {
    "2020s": 1.30,
    "2010s": 1.25,
    "2000s": 1.15,
    "1990s": 1.05,
    "1980s": 1.00,
    "1970s": 0.70,
    "1960s": 0.50,
    pre1960: 0.30,
  }[bucket] || 1;
}

function ratingWeight(row, minRating) {
  return 1 + Math.max(0, numeric(row.rating) - minRating) / 100;
}

function drawWeight(row, minRating) {
  return eraWeight(eraBucket(row)) * ratingWeight(row, minRating);
}

function isEligible(row, minRating, options) {
  if (numeric(row.rating) < minRating) return false;
  const minGames = String(row.position_group) === "G"
    ? options.minGoalieGames
    : options.minSkaterGames;
  return numeric(row.games_played) >= minGames;
}

function byCardQuality(a, b) {
  return (
    numeric(b.rating) - numeric(a.rating) ||
    numeric(b.adjusted_season_score) - numeric(a.adjusted_season_score) ||
    numeric(a.season_id) - numeric(b.season_id) ||
    String(a.player_name).localeCompare(String(b.player_name))
  );
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function enrichBackupRow(row, franchiseByTeam) {
  const mapped = franchiseByTeam.get(row.team);
  if (!mapped) return null;
  return {
    ...row,
    historical_team: row.team,
    team_name: mapped.team_name,
    franchise_key: mapped.franchise_key,
    franchise_name: mapped.franchise_name,
    current_team: mapped.current_team,
    franchise_status: mapped.franchise_status,
  };
}

function currentFranchises(mapRows) {
  return [...new Set(mapRows
    .map((row) => row.current_team)
    .filter(Boolean))]
    .sort();
}

function weightedPick(candidates, random) {
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.availableWeight, 0);
  if (totalWeight <= 0) return null;
  let target = random() * totalWeight;
  for (const candidate of candidates) {
    target -= candidate.availableWeight;
    if (target <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function slotCapacity(candidates, options) {
  const cardsByPlayer = new Map();
  for (const row of candidates) {
    const playerId = String(row.player_id);
    cardsByPlayer.set(playerId, (cardsByPlayer.get(playerId) || 0) + 1);
  }

  let capacity = 0;
  for (const cardCount of cardsByPlayer.values()) {
    capacity += Math.min(options.maxSlotsPerPlayer, cardCount * options.maxSlotsPerCard);
  }
  return capacity;
}

function buildSlotsForTeam(team, candidates, options, random) {
  const slots = [];
  const playerSlotCounts = new Map();
  const cardSlotCounts = new Map();
  const ranked = [...candidates].sort(byCardQuality);

  function addSlot(picked, selectionType) {
    const pickedCardId = cardId(picked);
    playerSlotCounts.set(String(picked.player_id), (playerSlotCounts.get(String(picked.player_id)) || 0) + 1);
    cardSlotCounts.set(pickedCardId, (cardSlotCounts.get(pickedCardId) || 0) + 1);

    const bucket = eraBucket(picked);
    const eWeight = eraWeight(bucket);
    const rWeight = ratingWeight(picked, picked.rating_floor);
    slots.push({
      franchise_key: team,
      board_pool_slot: slots.length + 1,
      board_card_id: pickedCardId,
      source_pool: picked.source_pool,
      selection_type: selectionType,
      draw_weight: Number((eWeight * rWeight).toFixed(6)),
      era_bucket: bucket,
      era_weight: eWeight,
      rating_weight: Number(rWeight.toFixed(6)),
      ...picked,
    });
  }

  function availableCandidates(excludeCardIds = new Set()) {
    return ranked
      .map((row) => {
        const playerCount = playerSlotCounts.get(String(row.player_id)) || 0;
        const cardCount = cardSlotCounts.get(cardId(row)) || 0;
        if (excludeCardIds.has(cardId(row))) return null;
        if (playerCount >= options.maxSlotsPerPlayer || cardCount >= options.maxSlotsPerCard) return null;
        return {
          row,
          availableWeight: drawWeight(row, row.rating_floor),
        };
      })
      .filter(Boolean);
  }

  const forcedCards = [];
  for (const row of ranked) {
    if (forcedCards.length >= Math.min(options.forcedTopCards, options.slotsPerTeam)) break;
    const playerCount = playerSlotCounts.get(String(row.player_id)) || 0;
    const cardCount = cardSlotCounts.get(cardId(row)) || 0;
    if (playerCount >= options.maxSlotsPerPlayer || cardCount >= options.maxSlotsPerCard) continue;
    forcedCards.push(row);
    addSlot(row, "forced_top");
  }

  const forcedCardIds = new Set(forcedCards.map((row) => cardId(row)));
  while (slots.length < options.slotsPerTeam) {
    const available = availableCandidates();
    if (available.length === 0) {
      throw new Error(`Unable to fill ${team}: slot caps exhausted after ${slots.length} slots`);
    }
    const freshAvailable = availableCandidates(forcedCardIds);
    const picked = weightedPick(freshAvailable.length > 0 ? freshAvailable : available, random).row;
    addSlot(picked, "weighted_fill");
  }

  return slots;
}

function buildTeamBoardPools(options) {
  const primaryRows = readCsv(options.primaryInput);
  const backupRows = readCsv(options.backupInput);
  const mapRows = readCsv(options.franchiseMap);
  assertColumns(backupRows, GAME_VALUE_COLUMNS);

  const franchiseByTeam = new Map(mapRows.map((row) => [row.team, row]));
  const teams = currentFranchises(mapRows);
  const primaryByTeam = new Map(teams.map((team) => [team, []]));
  const backupByTeam = new Map(teams.map((team) => [team, []]));
  const emergencyByTeam = new Map(teams.map((team) => [team, []]));
  const seenPrimaryCards = new Set();

  for (const row of primaryRows) {
    if (!isEligible(row, options.primaryMinRating, options)) continue;
    const team = row.franchise_key;
    if (!primaryByTeam.has(team)) continue;
    seenPrimaryCards.add(cardId(row));
    primaryByTeam.get(team).push({ ...row, source_pool: "primary", rating_floor: options.primaryMinRating });
  }

  for (const row of backupRows) {
    if (seenPrimaryCards.has(cardId(row))) continue;
    const enriched = enrichBackupRow(row, franchiseByTeam);
    if (!enriched || !backupByTeam.has(enriched.franchise_key)) continue;
    if (isEligible(row, options.backupMinRating, options)) {
      backupByTeam.get(enriched.franchise_key).push({
        ...enriched,
        source_pool: "backup",
        rating_floor: options.backupMinRating,
      });
    } else if (isEligible(row, options.emergencyMinRating, options)) {
      emergencyByTeam.get(enriched.franchise_key).push({
        ...enriched,
        source_pool: "emergency",
        rating_floor: options.emergencyMinRating,
      });
    }
  }

  const random = mulberry32(options.seed);
  const output = [];
  for (const team of teams) {
    const candidates = [...primaryByTeam.get(team)];
    if (candidates.length < options.slotsPerTeam) {
      candidates.push(...backupByTeam.get(team));
    }
    if (candidates.length < options.slotsPerTeam || slotCapacity(candidates, options) < options.slotsPerTeam) {
      candidates.push(...emergencyByTeam.get(team));
    }
    candidates.sort(byCardQuality);
    if (candidates.length < 10) {
      throw new Error(`Team ${team} has only ${candidates.length} board candidates; needs at least 10`);
    }
    output.push(...buildSlotsForTeam(team, candidates, options, random));
  }

  writeCsv(options.output, output, TEAM_BOARD_POOL_COLUMNS);
  console.log(`Wrote ${output.length} rows to ${options.output}`);
  return output;
}

if (require.main === module) {
  buildTeamBoardPools(parseArgs(process.argv));
}

module.exports = {
  TEAM_BOARD_POOL_COLUMNS,
  buildTeamBoardPools,
  drawWeight,
  eraBucket,
  eraWeight,
  isEligible,
  ratingWeight,
};
