const path = require("node:path");
const {
  numeric,
  readCsv,
  writeCsv,
} = require("./pipeline_common");
const { PLAYER_TEAM_WINDOW_COLUMNS } = require("./build_player_team_windows");

const TEAM_WINDOW_BOARD_POOL_COLUMNS = [
  "franchise_key",
  "board_pool_rank",
  "window_card_id",
  "source_pool",
  "selection_type",
  "draw_weight",
  "era_bucket",
  "era_weight",
  "rating_weight",
  ...PLAYER_TEAM_WINDOW_COLUMNS.filter((column) => ![
    "franchise_key",
    "window_card_id",
  ].includes(column)),
];

function parseArgs(argv) {
  const args = {
    input: path.join("data", "player_team_5yr_windows.csv"),
    franchiseMap: path.join("data", "franchise_map.csv"),
    output: path.join("data", "team_board_pools_5yr.csv"),
    maxCardsPerTeam: 100,
    forcedTopCards: 25,
    primaryMinRating: 60,
    backupMinRating: 30,
    emergencyMinRating: 0,
    maxCardsPerPlayer: 3,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--input") {
      args.input = value;
      i += 1;
    } else if (arg === "--franchise-map") {
      args.franchiseMap = value;
      i += 1;
    } else if (arg === "--output") {
      args.output = value;
      i += 1;
    } else if (arg === "--max-cards-per-team") {
      args.maxCardsPerTeam = Number(value);
      i += 1;
    } else if (arg === "--forced-top-cards") {
      args.forcedTopCards = Number(value);
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
    } else if (arg === "--max-cards-per-player") {
      args.maxCardsPerPlayer = Number(value);
      i += 1;
    }
  }
  return args;
}

function currentFranchises(mapRows) {
  return [...new Set(mapRows
    .map((row) => row.current_team)
    .filter(Boolean))]
    .sort();
}

function seasonStartFromId(seasonId) {
  return Number(String(seasonId).slice(0, 4));
}

function eraBucket(row) {
  const year = seasonStartFromId(row.window_end_season_id);
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
  return 1 + Math.max(0, numeric(row.window_rating) - minRating) / 100;
}

function drawWeight(row, minRating) {
  return eraWeight(eraBucket(row)) * ratingWeight(row, minRating);
}

function byCardQuality(a, b) {
  return (
    numeric(b.window_rating) - numeric(a.window_rating) ||
    numeric(b.window_adjusted_season_score) - numeric(a.window_adjusted_season_score) ||
    numeric(a.window_start_season_id) - numeric(b.window_start_season_id) ||
    String(a.player_name).localeCompare(String(b.player_name))
  );
}

function withPoolMetadata(row, sourcePool, ratingFloor) {
  const bucket = eraBucket(row);
  const eWeight = eraWeight(bucket);
  const rWeight = ratingWeight(row, ratingFloor);
  return {
    ...row,
    source_pool: sourcePool,
    draw_weight: Number((eWeight * rWeight).toFixed(6)),
    era_bucket: bucket,
    era_weight: eWeight,
    rating_weight: Number(rWeight.toFixed(6)),
  };
}

function poolRowsForTeam(teamRows, options) {
  const primary = teamRows
    .filter((row) => numeric(row.window_rating) >= options.primaryMinRating)
    .map((row) => withPoolMetadata(row, "primary", options.primaryMinRating));
  const backup = teamRows
    .filter((row) => numeric(row.window_rating) < options.primaryMinRating && numeric(row.window_rating) >= options.backupMinRating)
    .map((row) => withPoolMetadata(row, "backup", options.backupMinRating));
  const emergency = teamRows
    .filter((row) => numeric(row.window_rating) < options.backupMinRating && numeric(row.window_rating) >= options.emergencyMinRating)
    .map((row) => withPoolMetadata(row, "emergency", options.emergencyMinRating));

  const candidates = [...primary];
  if (candidates.length < options.maxCardsPerTeam) candidates.push(...backup);
  if (candidates.length < options.maxCardsPerTeam) candidates.push(...emergency);

  const ranked = candidates.sort(byCardQuality);
  const selected = [];
  const selectedCards = new Set();
  const playerCounts = new Map();

  function add(row, selectionType) {
    if (selected.length >= options.maxCardsPerTeam) return false;
    if (selectedCards.has(row.window_card_id)) return false;
    const playerId = String(row.player_id);
    const count = playerCounts.get(playerId) || 0;
    if (count >= options.maxCardsPerPlayer) return false;
    selected.push({ ...row, selection_type: selectionType });
    selectedCards.add(row.window_card_id);
    playerCounts.set(playerId, count + 1);
    return true;
  }

  for (const row of ranked) {
    if (selected.filter((candidate) => candidate.selection_type === "forced_top").length >= options.forcedTopCards) break;
    add(row, "forced_top");
  }

  const fillRanked = [...ranked].sort((a, b) => (
    numeric(b.draw_weight) - numeric(a.draw_weight) ||
    byCardQuality(a, b)
  ));
  for (const row of fillRanked) {
    if (selected.length >= options.maxCardsPerTeam) break;
    add(row, "weighted_candidate");
  }

  return selected
    .sort((a, b) => (
      (a.selection_type === "forced_top" ? 0 : 1) - (b.selection_type === "forced_top" ? 0 : 1) ||
      byCardQuality(a, b)
    ))
    .map((row, index) => ({
      franchise_key: row.franchise_key,
      board_pool_rank: index + 1,
      window_card_id: row.window_card_id,
      source_pool: row.source_pool,
      selection_type: row.selection_type,
      draw_weight: row.draw_weight,
      era_bucket: row.era_bucket,
      era_weight: row.era_weight,
      rating_weight: row.rating_weight,
      ...row,
    }));
}

function buildTeamWindowBoardPools(options) {
  const rows = readCsv(options.input);
  const mapRows = readCsv(options.franchiseMap);
  const missingColumns = PLAYER_TEAM_WINDOW_COLUMNS.filter((column) => !(column in (rows[0] || {})));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const teams = currentFranchises(mapRows);
  const rowsByTeam = new Map(teams.map((team) => [team, []]));
  for (const row of rows) {
    if (!rowsByTeam.has(row.franchise_key)) continue;
    rowsByTeam.get(row.franchise_key).push(row);
  }

  const output = [];
  for (const team of teams) {
    output.push(...poolRowsForTeam(rowsByTeam.get(team), options));
  }

  writeCsv(options.output, output, TEAM_WINDOW_BOARD_POOL_COLUMNS);
  console.log(`Wrote ${output.length} rows to ${options.output}`);
  return output;
}

if (require.main === module) {
  buildTeamWindowBoardPools(parseArgs(process.argv));
}

module.exports = {
  TEAM_WINDOW_BOARD_POOL_COLUMNS,
  buildTeamWindowBoardPools,
  drawWeight,
  eraBucket,
  poolRowsForTeam,
};
