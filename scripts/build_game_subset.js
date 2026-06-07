const path = require("node:path");
const {
  GAME_VALUE_COLUMNS,
  assertColumns,
  numeric,
  readCsv,
  writeCsv,
} = require("./pipeline_common");

function parseArgs(argv) {
  const args = {
    input: path.join("data", "player_game_values.csv"),
    output: path.join("data", "game_subset_player_seasons.csv"),
    minRating: 60,
    minSkaterGames: 70,
    minGoalieGames: 40,
    maxSeasonsPerPlayer: 3,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--input") {
      args.input = value;
      i += 1;
    } else if (arg === "--output") {
      args.output = value;
      i += 1;
    } else if (arg === "--min-rating") {
      args.minRating = Number(value);
      i += 1;
    } else if (arg === "--min-skater-games") {
      args.minSkaterGames = Number(value);
      i += 1;
    } else if (arg === "--min-goalie-games") {
      args.minGoalieGames = Number(value);
      i += 1;
    } else if (arg === "--max-seasons-per-player") {
      args.maxSeasonsPerPlayer = Number(value);
      i += 1;
    }
  }
  return args;
}

function byBestSeason(a, b) {
  return (
    numeric(b.rating) - numeric(a.rating) ||
    numeric(b.adjusted_season_score) - numeric(a.adjusted_season_score) ||
    numeric(a.season_id) - numeric(b.season_id) ||
    String(a.player_name).localeCompare(String(b.player_name))
  );
}

function isEligibleForGameSubset(row, options) {
  if (numeric(row.rating) < options.minRating) return false;
  const minGames = String(row.position_group) === "G"
    ? options.minGoalieGames
    : options.minSkaterGames;
  return numeric(row.games_played) >= minGames;
}

function bySeason(a, b) {
  return numeric(a.season_id) - numeric(b.season_id) || byBestSeason(a, b);
}

function bestSeason(rows) {
  return [...rows].sort(byBestSeason)[0];
}

function earlyCareerBestSeason(rows) {
  return bestSeason([...rows].sort(bySeason).slice(0, 2));
}

function earlyCareerRowsByBest(rows) {
  return [...rows].sort(bySeason).slice(0, 2).sort(byBestSeason);
}

function selectRepresentativeSeasons(playerRows, options) {
  const sortedByBest = [...playerRows].sort(byBestSeason);
  const sortedBySeason = [...playerRows].sort(bySeason);
  const selected = [];
  const selectedSeasons = new Set();

  function add(row) {
    if (!row || selected.length >= options.maxSeasonsPerPlayer) return false;
    const season = String(row.season_id);
    if (selectedSeasons.has(season)) return false;
    selected.push(row);
    selectedSeasons.add(season);
    return true;
  }

  function addBestAvailable(rows) {
    for (const row of rows) {
      if (add(row)) return true;
    }
    return false;
  }

  const rowsByTeam = new Map();
  for (const row of playerRows) {
    const team = String(row.team);
    const teamRows = rowsByTeam.get(team) || [];
    teamRows.push(row);
    rowsByTeam.set(team, teamRows);
  }

  const teamChapters = [...rowsByTeam.values()]
    .map((teamRows) => bestSeason(teamRows))
    .sort(byBestSeason);

  if (teamChapters.length >= options.maxSeasonsPerPlayer) {
    for (const row of teamChapters) add(row);
  } else if (teamChapters.length === 2) {
    for (const row of teamChapters) add(row);
    addBestAvailable(earlyCareerRowsByBest(playerRows));
  } else {
    add(earlyCareerBestSeason(playerRows));
    add(sortedByBest[0]);
    add(sortedBySeason[sortedBySeason.length - 1]);
  }

  for (const row of sortedByBest) {
    if (selected.length >= options.maxSeasonsPerPlayer) break;
    add(row);
  }

  return selected.sort(byBestSeason);
}

function buildGameSubset(options) {
  const rows = readCsv(options.input);
  assertColumns(rows, GAME_VALUE_COLUMNS);

  const candidates = rows.filter((row) => isEligibleForGameSubset(row, options));

  const rowsByPlayer = new Map();
  for (const row of candidates) {
    const playerId = String(row.player_id);
    const playerRows = rowsByPlayer.get(playerId) || [];
    playerRows.push(row);
    rowsByPlayer.set(playerId, playerRows);
  }

  const subset = [];
  for (const playerRows of rowsByPlayer.values()) {
    subset.push(...selectRepresentativeSeasons(playerRows, options));
  }

  subset.sort((a, b) => (
    String(a.rating_group).localeCompare(String(b.rating_group)) ||
    byBestSeason(a, b) ||
    String(a.player_name).localeCompare(String(b.player_name))
  ));

  writeCsv(options.output, subset, GAME_VALUE_COLUMNS);
  console.log(`Wrote ${subset.length} rows to ${options.output}`);
  return subset;
}

if (require.main === module) {
  buildGameSubset(parseArgs(process.argv));
}

module.exports = {
  buildGameSubset,
  isEligibleForGameSubset,
  selectRepresentativeSeasons,
};
