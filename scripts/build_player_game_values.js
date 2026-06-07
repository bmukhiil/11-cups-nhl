const path = require("node:path");
const {
  CLEAN_COLUMNS,
  GAME_VALUE_COLUMNS,
  SCORE_COLUMNS,
  ZSCORE_COLUMNS,
  assertColumns,
  numeric,
  ratingGroup,
  readCsv,
  validateCleanRows,
  withColumns,
  writeCsv,
} = require("./pipeline_common");

const SKATER_STATS = [
  "goals",
  "assists",
  "points",
  "plus_minus",
  "shots",
  "time_on_ice_per_game",
  "power_play_points",
  "short_handed_points",
  "game_winning_goals",
  "hits",
  "blocked_shots",
];

const GOALIE_STATS = [
  "wins",
  "save_percentage",
  "goals_against_average",
  "shutouts",
  "shots_against",
  "saves",
];

const RATING_ANCHORS = [
  [-2.0, 0],
  [-1.0, 25],
  [0.0, 50],
  [1.0, 74],
  [2.0, 86],
  [2.75, 94],
  [3.5, 98],
  [4.25, 100],
];

function parseArgs(argv) {
  const args = {
    input: path.join("data", "clean_player_seasons.csv"),
    outDir: "data",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--input") {
      args.input = value;
      i += 1;
    } else if (arg === "--out-dir") {
      args.outDir = value;
      i += 1;
    }
  }
  return args;
}

function mean(values) {
  if (values.length === 0) return "";
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values, avg) {
  if (values.length <= 1 || avg === "") return "";
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function contextKey(seasonId, playerType, statName) {
  return `${seasonId}|${playerType}|${statName}`;
}

function calculateLeagueContext(rows) {
  const contextRows = [];
  const context = new Map();
  const seasons = [...new Set(rows.map((row) => row.season_id))].sort();

  for (const seasonId of seasons) {
    for (const [playerType, stats] of [["skater", SKATER_STATS], ["goalie", GOALIE_STATS]]) {
      const playerRows = rows.filter((row) => row.season_id === seasonId && row.player_type === playerType);
      for (const statName of stats) {
        const values = playerRows.map((row) => numeric(row[statName])).filter(Number.isFinite);
        const avg = mean(values);
        const deviation = std(values, avg);
        const contextRow = {
          season_id: seasonId,
          player_type: playerType,
          stat_name: statName,
          mean: avg,
          std: deviation,
          eligible_player_count: values.length,
        };
        contextRows.push(contextRow);
        context.set(contextKey(seasonId, playerType, statName), contextRow);
      }
    }
  }

  return { contextRows, context };
}

function zScore(value, contextRow, invert = false) {
  const parsed = numeric(value);
  const avg = numeric(contextRow?.mean);
  const deviation = numeric(contextRow?.std);
  if (!Number.isFinite(parsed) || !Number.isFinite(avg) || !Number.isFinite(deviation) || deviation === 0) {
    return 0;
  }
  const score = (parsed - avg) / deviation;
  return invert ? -1 * score : score;
}

function calculateZScores(rows, context) {
  return rows.map((row) => {
    const z = {
      player_id: row.player_id,
      player_name: row.player_name,
      season_id: row.season_id,
      season_label: row.season_label,
      team: row.team,
      position: row.position,
      position_group: row.position_group,
      player_type: row.player_type,
      games_played: row.games_played,
    };

    for (const stat of SKATER_STATS) {
      z[`${stat}_z`] = zScore(row[stat], context.get(contextKey(row.season_id, "skater", stat)));
    }
    for (const stat of GOALIE_STATS) {
      z[`${stat}_z`] = zScore(
        row[stat],
        context.get(contextKey(row.season_id, "goalie", stat)),
        stat === "goals_against_average",
      );
    }
    return withColumns(z, ZSCORE_COLUMNS);
  });
}

function forwardScore(row) {
  return (
    0.30 * numeric(row.goals_z) +
    0.30 * numeric(row.assists_z) +
    0.16 * numeric(row.points_z) +
    0.09 * numeric(row.plus_minus_z) +
    0.10 * numeric(row.shots_z) +
    0.05 * numeric(row.power_play_points_z)
  );
}

function defenseScore(row) {
  return (
    0.15 * numeric(row.goals_z) +
    0.25 * numeric(row.assists_z) +
    0.17 * numeric(row.points_z) +
    0.13 * numeric(row.plus_minus_z) +
    0.15 * numeric(row.time_on_ice_per_game_z) +
    0.15 * numeric(row.shots_z)
  );
}

function goalieScore(row) {
  return (
    0.35 * numeric(row.save_percentage_z) +
    0.20 * numeric(row.wins_z) +
    0.20 * numeric(row.goals_against_average_z) +
    0.15 * numeric(row.shutouts_z) +
    0.10 * numeric(row.saves_z)
  );
}

function scoreRows(zRows) {
  return zRows.map((row) => {
    let seasonScore = 0;
    let offense = "";
    let defense = "";
    let goalie = "";
    if (row.player_type === "goalie") {
      seasonScore = goalieScore(row);
      goalie = seasonScore;
    } else if (row.position_group === "D") {
      seasonScore = defenseScore(row);
      defense = seasonScore;
    } else {
      seasonScore = forwardScore(row);
      offense = seasonScore;
    }
    const gamesPlayed = numeric(row.games_played);
    const reliability = row.player_type === "goalie"
      ? Math.min(1, gamesPlayed / 40)
      : Math.min(1, gamesPlayed / 65);
    return withColumns({
      player_id: row.player_id,
      player_name: row.player_name,
      season_id: row.season_id,
      season_label: row.season_label,
      team: row.team,
      position: row.position,
      position_group: row.position_group,
      player_type: row.player_type,
      games_played: row.games_played,
      season_score: seasonScore,
      adjusted_season_score: seasonScore * reliability,
      offense_score: offense,
      defense_context_score: defense,
      goalie_score: goalie,
    }, SCORE_COLUMNS);
  });
}

function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
}

function ratingFromZScore(zScore) {
  const value = Math.max(RATING_ANCHORS[0][0], Math.min(RATING_ANCHORS[RATING_ANCHORS.length - 1][0], zScore));
  for (let i = 0; i < RATING_ANCHORS.length - 1; i += 1) {
    const [lowerZ, lowerRating] = RATING_ANCHORS[i];
    const [upperZ, upperRating] = RATING_ANCHORS[i + 1];
    if (value >= lowerZ && value <= upperZ) {
      const span = upperZ - lowerZ;
      const ratio = span === 0 ? 0 : (value - lowerZ) / span;
      return Math.max(0, Math.min(100, Math.round(lowerRating + ((upperRating - lowerRating) * ratio))));
    }
  }
  return 100;
}

function topHalfPercentile(percentile) {
  return Math.max(0, Math.min(1, (percentile - 0.5) / 0.5));
}

function assignRatings(scoreRowsInput) {
  const output = scoreRowsInput.map((row) => ({
    ...row,
    rating_group: ratingGroup(row.position_group),
  }));
  const groups = [...new Set(output.map((row) => row.rating_group))];

  for (const group of groups) {
    const rows = output.filter((row) => row.rating_group === group);
    const scores = rows.map((row) => numeric(row.adjusted_season_score)).filter(Number.isFinite);
    const lower = quantile(scores, 0.001);
    const upper = quantile(scores, 0.999);
    const decorated = rows.map((row, index) => ({
      row,
      index,
      winsorized: Math.min(Math.max(numeric(row.adjusted_season_score), lower), upper),
    })).sort((a, b) => a.winsorized - b.winsorized || a.index - b.index);

    const playableRows = [];
    let i = 0;
    while (i < decorated.length) {
      let j = i + 1;
      while (j < decorated.length && decorated[j].winsorized === decorated[i].winsorized) j += 1;
      const averageRank = (i + j - 2) / 2;
      const percentile = decorated.length === 1 ? 1 : averageRank / (decorated.length - 1);
      for (let k = i; k < j; k += 1) {
        decorated[k].row.rating_percentile = percentile;
        if (percentile >= 0.5) playableRows.push(decorated[k].row);
      }
      i = j;
    }

    const playableScores = playableRows.map((row) => numeric(row.adjusted_season_score)).filter(Number.isFinite);
    const meanScore = mean(playableScores);
    const stdScore = std(playableScores, meanScore);
    for (const row of playableRows) {
      const gameZ = stdScore === 0 ? 0 : (numeric(row.adjusted_season_score) - meanScore) / stdScore;
      row.game_score_z = gameZ;
      row.rating = ratingFromZScore(gameZ);
    }
  }

  return output.filter((row) => Number.isFinite(Number(row.rating)));
}

function salaryFromRating(rating) {
  return Math.round(5 + (30 * ((rating / 100) ** 3)));
}

function buildGameValues(cleanRows, scoreRowsInput) {
  const sourceByKey = new Map(cleanRows.map((row) => [
    `${row.player_id}|${row.season_id}|${row.team}`,
    row.source,
  ]));
  return assignRatings(scoreRowsInput).map((row) => {
    const rating = numeric(row.rating);
    return withColumns({
      player_id: row.player_id,
      player_name: row.player_name,
      season_id: row.season_id,
      season_label: row.season_label,
      team: row.team,
      position: row.position,
      position_group: row.position_group,
      player_type: row.player_type,
      games_played: row.games_played,
      season_score: row.season_score,
      adjusted_season_score: row.adjusted_season_score,
      rating_group: row.rating_group,
      rating,
      salary: salaryFromRating(rating),
      game_points: Math.round(rating),
      source: sourceByKey.get(`${row.player_id}|${row.season_id}|${row.team}`) || "nhl_stats_api",
    }, GAME_VALUE_COLUMNS);
  });
}

function validateGameValues(cleanRows, gameRows) {
  if (gameRows.length >= cleanRows.length) {
    throw new Error(`Expected game values to be a top-half subset of ${cleanRows.length} clean rows, got ${gameRows.length}`);
  }
  for (const row of gameRows) {
    const rating = numeric(row.rating);
    if (rating < 0 || rating > 100) throw new Error(`Rating out of range: ${rating}`);
    if (!Number.isInteger(numeric(row.salary)) || numeric(row.salary) <= 0) throw new Error("Invalid salary");
    if (!Number.isInteger(numeric(row.game_points)) || numeric(row.game_points) < 0) throw new Error("Invalid game_points");
    if (!row.rating_group) throw new Error("Missing rating_group");
  }
}

function buildPlayerGameValues(options) {
  const cleanRows = readCsv(options.input);
  assertColumns(cleanRows, CLEAN_COLUMNS);
  validateCleanRows(cleanRows);

  const { contextRows, context } = calculateLeagueContext(cleanRows);
  const zRows = calculateZScores(cleanRows, context);
  const scoredRows = scoreRows(zRows);
  const gameRows = buildGameValues(cleanRows, scoredRows);
  validateGameValues(cleanRows, gameRows);

  writeCsv(path.join(options.outDir, "league_season_context.csv"), contextRows, [
    "season_id",
    "player_type",
    "stat_name",
    "mean",
    "std",
    "eligible_player_count",
  ]);
  writeCsv(path.join(options.outDir, "player_season_zscores.csv"), zRows, ZSCORE_COLUMNS);
  writeCsv(path.join(options.outDir, "player_season_scores.csv"), scoredRows, SCORE_COLUMNS);
  writeCsv(path.join(options.outDir, "player_game_values.csv"), gameRows, GAME_VALUE_COLUMNS);
  console.log(`Wrote ${gameRows.length} player game value rows to ${options.outDir}`);
  return { contextRows, zRows, scoredRows, gameRows };
}

if (require.main === module) {
  buildPlayerGameValues(parseArgs(process.argv));
}

module.exports = {
  buildGameValues,
  buildPlayerGameValues,
  calculateLeagueContext,
  calculateZScores,
  defenseScore,
  forwardScore,
  goalieScore,
  ratingFromZScore,
  salaryFromRating,
  scoreRows,
  topHalfPercentile,
  zScore,
};
