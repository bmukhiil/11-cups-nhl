const path = require("node:path");
const {
  GAME_VALUE_COLUMNS,
  assertColumns,
  numeric,
  readCsv,
  writeCsv,
} = require("./pipeline_common");

const PLAYER_TEAM_WINDOW_COLUMNS = [
  "window_card_id",
  "player_id",
  "player_name",
  "historical_team",
  "team_name",
  "franchise_key",
  "franchise_name",
  "current_team",
  "franchise_status",
  "position",
  "position_group",
  "player_type",
  "rating_group",
  "window_type",
  "window_label",
  "window_start_season_id",
  "window_end_season_id",
  "window_season_count",
  "scored_season_count",
  "thin_window",
  "component_season_ids",
  "component_season_labels",
  "component_ratings",
  "component_weights",
  "window_base_rating",
  "player_team_career_rating",
  "career_component_season_ids",
  "career_component_ratings",
  "career_component_weights",
  "window_rating",
  "window_salary",
  "window_game_points",
  "window_adjusted_season_score",
  "window_season_score",
  "source",
];

function parseArgs(argv) {
  const args = {
    input: path.join("data", "player_game_values.csv"),
    franchiseMap: path.join("data", "franchise_map.csv"),
    output: path.join("data", "player_team_5yr_windows.csv"),
    minSkaterGames: 70,
    minGoalieGames: 40,
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
    } else if (arg === "--min-skater-games") {
      args.minSkaterGames = Number(value);
      i += 1;
    } else if (arg === "--min-goalie-games") {
      args.minGoalieGames = Number(value);
      i += 1;
    }
  }
  return args;
}

function seasonStart(row) {
  return Number(String(row.season_id).slice(0, 4));
}

function seasonIdFromStartYear(year) {
  return Number(`${year}${year + 1}`);
}

function seasonLabelFromStartYear(year) {
  return `${year}-${String(year + 1).slice(2)}`;
}

function bySeason(a, b) {
  return numeric(a.season_id) - numeric(b.season_id);
}

function byBestSeason(a, b) {
  return (
    numeric(b.adjusted_season_score) - numeric(a.adjusted_season_score) ||
    numeric(b.rating) - numeric(a.rating) ||
    numeric(a.season_id) - numeric(b.season_id)
  );
}

function isEligibleSeason(row, options) {
  const minGames = String(row.position_group) === "G"
    ? options.minGoalieGames
    : options.minSkaterGames;
  return numeric(row.games_played) >= minGames;
}

function normalizedWeights(count) {
  const base = [0.5, 0.3, 0.2].slice(0, count);
  const total = base.reduce((sum, value) => sum + value, 0);
  return base.map((value) => value / total);
}

function weightedAverage(rows, weights, column) {
  return rows.reduce((sum, row, index) => sum + numeric(row[column]) * weights[index], 0);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function windowLabel(startYear, endYear) {
  if (startYear === endYear) return seasonLabelFromStartYear(startYear);
  return `${seasonLabelFromStartYear(startYear)} to ${seasonLabelFromStartYear(endYear)}`;
}

function windowScore(windowRows) {
  const scoredRows = [...windowRows].sort(byBestSeason).slice(0, 3);
  const weights = normalizedWeights(scoredRows.length);
  return {
    scoredRows,
    weights,
    rating: weightedAverage(scoredRows, weights, "rating"),
    salary: weightedAverage(scoredRows, weights, "salary"),
    gamePoints: weightedAverage(scoredRows, weights, "game_points"),
    adjustedSeasonScore: weightedAverage(scoredRows, weights, "adjusted_season_score"),
    seasonScore: weightedAverage(scoredRows, weights, "season_score"),
  };
}

function careerWeights(count) {
  const base = [0.25, 0.20, 0.16, 0.13, 0.10, 0.08, 0.08].slice(0, count);
  const total = base.reduce((sum, value) => sum + value, 0);
  return base.map((value) => value / total);
}

function playerTeamCareerScore(playerRows) {
  const scoredRows = [...playerRows].sort(byBestSeason).slice(0, 7);
  const weights = careerWeights(scoredRows.length);
  return {
    scoredRows,
    weights,
    rating: weightedAverage(scoredRows, weights, "rating"),
  };
}

function rowsInCalendarWindow(rows, startYear, endYear) {
  return rows.filter((row) => {
    const year = seasonStart(row);
    return year >= startYear && year <= endYear;
  });
}

function bestPeakWindow(rows) {
  const sorted = [...rows].sort(bySeason);
  const minYear = seasonStart(sorted[0]);
  const maxYear = seasonStart(sorted[sorted.length - 1]);
  if (maxYear - minYear <= 4) {
    return { rows: sorted, startYear: minYear, endYear: maxYear };
  }

  const candidates = [];
  for (let startYear = minYear; startYear <= maxYear - 4; startYear += 1) {
    const candidate = rowsInCalendarWindow(sorted, startYear, startYear + 4);
    if (candidate.length === 0) continue;
    const score = windowScore(candidate);
    candidates.push({ rows: candidate, score, startYear, endYear: startYear + 4 });
  }
  const maxScoredSeasonCount = Math.max(...candidates.map((candidate) => candidate.score.scoredRows.length));
  return candidates
    .filter((candidate) => candidate.score.scoredRows.length === maxScoredSeasonCount)
    .sort((a, b) => (
      b.score.rating - a.score.rating ||
      b.score.adjustedSeasonScore - a.score.adjustedSeasonScore ||
      a.startYear - b.startYear
    ))[0];
}

function makeWindowRow(playerRows, windowRows, windowType, startYear, endYear, franchiseByTeam) {
  const sortedWindowRows = [...windowRows].sort(bySeason);
  const score = windowScore(sortedWindowRows);
  const careerScore = playerTeamCareerScore(playerRows);
  const blendedRating = (score.rating * 0.75) + (careerScore.rating * 0.25);
  const finalWindowRating = windowType === "peak"
    ? Math.max(score.rating, blendedRating)
    : score.rating;
  const first = sortedWindowRows[0];
  const mapped = franchiseByTeam.get(first.team);
  const componentSeasonIds = score.scoredRows.map((row) => row.season_id);
  const componentSeasonLabels = score.scoredRows.map((row) => row.season_label);
  const componentRatings = score.scoredRows.map((row) => row.rating);
  const componentWeights = score.weights.map((weight) => round(weight, 4));
  const careerComponentSeasonIds = careerScore.scoredRows.map((row) => row.season_id);
  const careerComponentRatings = careerScore.scoredRows.map((row) => row.rating);
  const careerComponentWeights = careerScore.weights.map((weight) => round(weight, 4));
  const windowCardId = [
    first.player_id,
    first.team,
    windowType,
    componentSeasonIds.join("-"),
  ].join("-");

  return {
    window_card_id: windowCardId,
    player_id: first.player_id,
    player_name: first.player_name,
    historical_team: first.team,
    team_name: mapped.team_name,
    franchise_key: mapped.franchise_key,
    franchise_name: mapped.franchise_name,
    current_team: mapped.current_team,
    franchise_status: mapped.franchise_status,
    position: first.position,
    position_group: first.position_group,
    player_type: first.player_type,
    rating_group: first.rating_group,
    window_type: windowType,
    window_label: windowLabel(startYear, endYear),
    window_start_season_id: seasonIdFromStartYear(startYear),
    window_end_season_id: seasonIdFromStartYear(endYear),
    window_season_count: sortedWindowRows.length,
    scored_season_count: score.scoredRows.length,
    thin_window: score.scoredRows.length < 3 ? "true" : "false",
    component_season_ids: componentSeasonIds.join("|"),
    component_season_labels: componentSeasonLabels.join("|"),
    component_ratings: componentRatings.join("|"),
    component_weights: componentWeights.join("|"),
    window_base_rating: Math.round(score.rating),
    player_team_career_rating: Math.round(careerScore.rating),
    career_component_season_ids: careerComponentSeasonIds.join("|"),
    career_component_ratings: careerComponentRatings.join("|"),
    career_component_weights: careerComponentWeights.join("|"),
    window_rating: Math.round(finalWindowRating),
    window_salary: Math.round(score.salary),
    window_game_points: Math.round(score.gamePoints),
    window_adjusted_season_score: round(score.adjustedSeasonScore, 6),
    window_season_score: round(score.seasonScore, 6),
    source: "player_team_5yr_window",
  };
}

function selectWindowsForPlayerTeam(playerRows, franchiseByTeam) {
  const sorted = [...playerRows].sort(bySeason);
  const minYear = seasonStart(sorted[0]);
  const maxYear = seasonStart(sorted[sorted.length - 1]);
  const earlyStartYear = minYear;
  const earlyEndYear = Math.min(minYear + 4, maxYear);
  const lateStartYear = Math.max(minYear, maxYear - 4);
  const lateEndYear = maxYear;
  const peakWindow = bestPeakWindow(sorted);
  const rawWindows = [
    {
      type: "early",
      rows: rowsInCalendarWindow(sorted, earlyStartYear, earlyEndYear),
      startYear: earlyStartYear,
      endYear: earlyEndYear,
    },
    {
      type: "peak",
      rows: peakWindow.rows,
      startYear: peakWindow.startYear,
      endYear: peakWindow.endYear,
    },
    {
      type: "late",
      rows: rowsInCalendarWindow(sorted, lateStartYear, lateEndYear),
      startYear: lateStartYear,
      endYear: lateEndYear,
    },
  ];

  const selected = [];
  const seenComponents = new Set();
  for (const item of rawWindows) {
    if (item.rows.length === 0) continue;
    const row = makeWindowRow(sorted, item.rows, item.type, item.startYear, item.endYear, franchiseByTeam);
    const key = row.component_season_ids;
    if (seenComponents.has(key)) continue;
    selected.push(row);
    seenComponents.add(key);
  }
  return selected;
}

function buildPlayerTeamWindows(options) {
  const rows = readCsv(options.input);
  const mapRows = readCsv(options.franchiseMap);
  assertColumns(rows, GAME_VALUE_COLUMNS);

  const franchiseByTeam = new Map(mapRows.map((row) => [row.team, row]));
  const missingTeams = [...new Set(rows.map((row) => row.team))]
    .filter((team) => !franchiseByTeam.has(team))
    .sort();
  if (missingTeams.length > 0) {
    throw new Error(`Missing franchise mappings for teams: ${missingTeams.join(", ")}`);
  }

  const groups = new Map();
  for (const row of rows.filter((candidate) => isEligibleSeason(candidate, options))) {
    const key = `${row.player_id}|${row.team}`;
    const groupRows = groups.get(key) || [];
    groupRows.push(row);
    groups.set(key, groupRows);
  }

  const output = [];
  for (const groupRows of groups.values()) {
    output.push(...selectWindowsForPlayerTeam(groupRows, franchiseByTeam));
  }

  output.sort((a, b) => (
    String(a.franchise_key).localeCompare(String(b.franchise_key)) ||
    numeric(b.window_rating) - numeric(a.window_rating) ||
    numeric(b.window_adjusted_season_score) - numeric(a.window_adjusted_season_score) ||
    String(a.player_name).localeCompare(String(b.player_name))
  ));

  writeCsv(options.output, output, PLAYER_TEAM_WINDOW_COLUMNS);
  console.log(`Wrote ${output.length} rows to ${options.output}`);
  return output;
}

if (require.main === module) {
  buildPlayerTeamWindows(parseArgs(process.argv));
}

module.exports = {
  PLAYER_TEAM_WINDOW_COLUMNS,
  buildPlayerTeamWindows,
  careerWeights,
  playerTeamCareerScore,
  normalizedWeights,
  selectWindowsForPlayerTeam,
  windowScore,
};
