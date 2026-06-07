const path = require("node:path");
const { readCsv, writeCsv, numeric } = require("./pipeline_common");

const ROSTER_TEMPLATE = {
  C: 2,
  W: 2,
  D: 2,
  G: 1,
};

const THRESHOLD_COLUMNS = [
  "percentile",
  "score",
  "rings",
];

const SUMMARY_COLUMNS = [
  "metric",
  "value",
];

function parseArgs(argv) {
  const args = {
    input: path.join("data", "team_board_pools_hockey_reference_raw.csv"),
    output: path.join("data", "draft_percentile_thresholds_hockey_reference.csv"),
    summaryOutput: path.join("data", "draft_percentile_summary_hockey_reference.csv"),
    simulations: 50000,
    boardSize: 10,
    seed: 1107,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--input") {
      args.input = value;
      index += 1;
    } else if (arg === "--output") {
      args.output = value;
      index += 1;
    } else if (arg === "--summary-output") {
      args.summaryOutput = value;
      index += 1;
    } else if (arg === "--simulations") {
      args.simulations = Number(value);
      index += 1;
    } else if (arg === "--board-size") {
      args.boardSize = Number(value);
      index += 1;
    } else if (arg === "--seed") {
      args.seed = Number(value);
      index += 1;
    }
  }
  return args;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function sample(items, count, random) {
  if (items.length <= count) return shuffle(items, random);
  return shuffle(items, random).slice(0, count);
}

function normalizePosition(row) {
  const position = String(row.position || "").toUpperCase();
  if (position === "G") return "G";
  if (position === "D") return "D";
  if (position === "C") return "C";
  return "W";
}

function canFit(row, rosterNeeds) {
  const slot = normalizePosition(row);
  return (rosterNeeds[slot] || 0) > 0;
}

function pickScore(row) {
  return numeric(row.raw_card_ps);
}

function smartPick(board, rosterNeeds, draftedPlayerIds) {
  return board
    .filter((row) => canFit(row, rosterNeeds))
    .filter((row) => !draftedPlayerIds.has(row.player_id))
    .sort((a, b) => (
      pickScore(b) - pickScore(a) ||
      String(a.player_name).localeCompare(String(b.player_name)) ||
      String(a.card_id).localeCompare(String(b.card_id))
    ))[0] || null;
}

function teamsFromRows(rows) {
  return [...new Set(rows.map((row) => row.franchise_key).filter(Boolean))].sort();
}

function groupByTeam(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const teamRows = byTeam.get(row.franchise_key) || [];
    teamRows.push(row);
    byTeam.set(row.franchise_key, teamRows);
  }
  return byTeam;
}

function chooseRandomTeam(teams, random) {
  return teams[Math.floor(random() * teams.length)];
}

function simulateDraft(byTeam, teams, options, random) {
  const rosterNeeds = { ...ROSTER_TEMPLATE };
  const drafted = [];
  const draftedPlayerIds = new Set();
  let failedPicks = 0;

  while (Object.values(rosterNeeds).some((needed) => needed > 0)) {
    let pick = null;
    for (let attempt = 0; attempt < teams.length * 2 && !pick; attempt += 1) {
      const team = chooseRandomTeam(teams, random);
      const board = sample(byTeam.get(team) || [], options.boardSize, random);
      pick = smartPick(board, rosterNeeds, draftedPlayerIds);
    }

    if (!pick) {
      failedPicks += 1;
      break;
    }

    const slot = normalizePosition(pick);
    rosterNeeds[slot] -= 1;
    drafted.push(pick);
    draftedPlayerIds.add(pick.player_id);
  }

  const score = drafted.reduce((sum, row) => sum + pickScore(row), 0);
  return {
    complete: drafted.length === 7,
    failedPicks,
    score,
    drafted,
  };
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function ringsForPercentile(percentile) {
  if (percentile >= 98) return 6;
  if (percentile >= 93) return 5;
  if (percentile >= 85) return 4;
  if (percentile >= 75) return 3;
  if (percentile >= 65) return 2;
  if (percentile >= 50) return 1;
  return 0;
}

function buildThresholdRows(scores) {
  const percentiles = [0, 5, 10, 25, 50, 65, 75, 85, 90, 93, 95, 97, 98, 99, 100];
  return percentiles.map((percentile) => ({
    percentile,
    score: Number(quantile(scores, percentile).toFixed(3)),
    rings: ringsForPercentile(percentile),
  }));
}

function scoreToPercentile(score, sortedScores) {
  let low = 0;
  let high = sortedScores.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedScores[mid] <= score) low = mid + 1;
    else high = mid;
  }
  return (low / sortedScores.length) * 100;
}

function runSimulation(options) {
  const rows = readCsv(options.input)
    .map((row) => ({ ...row, raw_card_ps: numeric(row.raw_card_ps) }))
    .filter((row) => Number.isFinite(row.raw_card_ps));
  const byTeam = groupByTeam(rows);
  const teams = teamsFromRows(rows);
  const random = mulberry32(options.seed);

  const scores = [];
  let completeDrafts = 0;
  let failedDrafts = 0;
  for (let index = 0; index < options.simulations; index += 1) {
    const result = simulateDraft(byTeam, teams, options, random);
    if (result.complete) {
      completeDrafts += 1;
      scores.push(result.score);
    } else {
      failedDrafts += 1;
    }
  }

  scores.sort((a, b) => a - b);
  const thresholdRows = buildThresholdRows(scores);
  writeCsv(options.output, thresholdRows, THRESHOLD_COLUMNS);

  const summaryRows = [
    { metric: "input", value: options.input },
    { metric: "simulations_requested", value: options.simulations },
    { metric: "complete_drafts", value: completeDrafts },
    { metric: "failed_drafts", value: failedDrafts },
    { metric: "board_size", value: options.boardSize },
    { metric: "seed", value: options.seed },
    { metric: "team_count", value: teams.length },
    { metric: "card_count", value: rows.length },
    { metric: "min_score", value: Number(quantile(scores, 0).toFixed(3)) },
    { metric: "median_score", value: Number(quantile(scores, 50).toFixed(3)) },
    { metric: "avg_score", value: Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3)) },
    { metric: "max_score", value: Number(quantile(scores, 100).toFixed(3)) },
    { metric: "one_ring_score_p50", value: Number(quantile(scores, 50).toFixed(3)) },
    { metric: "two_ring_score_p65", value: Number(quantile(scores, 65).toFixed(3)) },
    { metric: "three_ring_score_p75", value: Number(quantile(scores, 75).toFixed(3)) },
    { metric: "four_ring_score_p85", value: Number(quantile(scores, 85).toFixed(3)) },
    { metric: "five_ring_score_p93", value: Number(quantile(scores, 93).toFixed(3)) },
    { metric: "six_ring_score_p98", value: Number(quantile(scores, 98).toFixed(3)) },
  ];
  writeCsv(options.summaryOutput, summaryRows, SUMMARY_COLUMNS);

  console.log(`Wrote ${thresholdRows.length} percentile thresholds to ${options.output}`);
  console.log(`Wrote summary to ${options.summaryOutput}`);
  console.log(`Complete drafts: ${completeDrafts}/${options.simulations}`);
  console.log(`Median score: ${quantile(scores, 50).toFixed(3)}`);
  console.log(`Six-ring score: ${quantile(scores, 98).toFixed(3)}`);
  return { scores, thresholdRows, summaryRows };
}

if (require.main === module) {
  runSimulation(parseArgs(process.argv));
}

module.exports = {
  ROSTER_TEMPLATE,
  ringsForPercentile,
  runSimulation,
  scoreToPercentile,
  simulateDraft,
};
