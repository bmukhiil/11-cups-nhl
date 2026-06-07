const fs = require("node:fs");
const path = require("node:path");

const CLEAN_COLUMNS = [
  "player_id",
  "player_name",
  "season_id",
  "season_label",
  "team",
  "position",
  "position_group",
  "player_type",
  "games_played",
  "goals",
  "assists",
  "points",
  "plus_minus",
  "shots",
  "shooting_pct",
  "time_on_ice_per_game",
  "faceoff_win_pct",
  "penalty_minutes",
  "power_play_goals",
  "power_play_points",
  "short_handed_goals",
  "short_handed_points",
  "game_winning_goals",
  "overtime_goals",
  "hits",
  "blocked_shots",
  "wins",
  "losses",
  "ties",
  "overtime_losses",
  "save_percentage",
  "goals_against_average",
  "shutouts",
  "goals_against",
  "shots_against",
  "saves",
  "source",
];

const ZSCORE_COLUMNS = [
  "player_id",
  "player_name",
  "season_id",
  "season_label",
  "team",
  "position",
  "position_group",
  "player_type",
  "games_played",
  "goals_z",
  "assists_z",
  "points_z",
  "plus_minus_z",
  "shots_z",
  "time_on_ice_per_game_z",
  "power_play_points_z",
  "short_handed_points_z",
  "game_winning_goals_z",
  "hits_z",
  "blocked_shots_z",
  "wins_z",
  "save_percentage_z",
  "goals_against_average_z",
  "shutouts_z",
  "shots_against_z",
  "saves_z",
];

const SCORE_COLUMNS = [
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
  "offense_score",
  "defense_context_score",
  "goalie_score",
];

const GAME_VALUE_COLUMNS = [
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
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function seasonLabel(seasonId) {
  const raw = String(seasonId);
  if (!/^\d{8}$/.test(raw)) {
    throw new Error(`Invalid season_id: ${seasonId}`);
  }
  return `${raw.slice(0, 4)}-${raw.slice(6)}`;
}

function seasonIds(startSeason, endSeason) {
  const startYear = Number(String(startSeason).slice(0, 4));
  const endYear = Number(String(endSeason).slice(0, 4));
  const ids = [];
  for (let year = startYear; year <= endYear; year += 1) {
    ids.push(Number(`${year}${year + 1}`));
  }
  return ids;
}

function positionGroup(position) {
  const normalized = String(position || "").toUpperCase();
  if (["C", "L", "R", "LW", "RW"].includes(normalized)) return "F";
  if (normalized === "D") return "D";
  if (normalized === "G") return "G";
  return "";
}

function ratingGroup(positionGroupValue) {
  if (positionGroupValue === "F") return "forwards";
  if (positionGroupValue === "D") return "defensemen";
  if (positionGroupValue === "G") return "goalies";
  return "";
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function num(value) {
  if (isBlank(value)) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function numeric(value) {
  if (isBlank(value)) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function cleanTeam(teamAbbrevs) {
  if (isBlank(teamAbbrevs)) return "";
  return String(teamAbbrevs).trim();
}

function shouldDropBase(row) {
  const team = cleanTeam(row.teamAbbrevs);
  return (
    isBlank(row.playerId) ||
    isBlank(row.seasonId) ||
    isBlank(team) ||
    team.includes(",") ||
    numeric(row.gamesPlayed) < 40
  );
}

function normalizeSkater(summaryRow, realtimeRow = undefined) {
  if (shouldDropBase(summaryRow) || isBlank(summaryRow.skaterFullName)) return null;
  const position = String(summaryRow.positionCode || "").toUpperCase();
  const group = positionGroup(position);
  if (!group || group === "G") return null;

  return withColumns({
    player_id: summaryRow.playerId,
    player_name: summaryRow.skaterFullName,
    season_id: summaryRow.seasonId,
    season_label: seasonLabel(summaryRow.seasonId),
    team: cleanTeam(summaryRow.teamAbbrevs),
    position,
    position_group: group,
    player_type: "skater",
    games_played: num(summaryRow.gamesPlayed),
    goals: num(summaryRow.goals),
    assists: num(summaryRow.assists),
    points: num(summaryRow.points),
    plus_minus: num(summaryRow.plusMinus),
    shots: num(summaryRow.shots),
    shooting_pct: num(summaryRow.shootingPct),
    time_on_ice_per_game: num(summaryRow.timeOnIcePerGame),
    faceoff_win_pct: num(summaryRow.faceoffWinPct),
    penalty_minutes: num(summaryRow.penaltyMinutes),
    power_play_goals: num(summaryRow.ppGoals),
    power_play_points: num(summaryRow.ppPoints),
    short_handed_goals: num(summaryRow.shGoals),
    short_handed_points: num(summaryRow.shPoints),
    game_winning_goals: num(summaryRow.gameWinningGoals),
    overtime_goals: num(summaryRow.otGoals),
    hits: realtimeRow ? num(realtimeRow.hits) : "",
    blocked_shots: realtimeRow ? num(realtimeRow.blockedShots) : "",
    source: "nhl_stats_api",
  }, CLEAN_COLUMNS);
}

function normalizeGoalie(row) {
  if (shouldDropBase(row) || isBlank(row.goalieFullName)) return null;
  return withColumns({
    player_id: row.playerId,
    player_name: row.goalieFullName,
    season_id: row.seasonId,
    season_label: seasonLabel(row.seasonId),
    team: cleanTeam(row.teamAbbrevs),
    position: "G",
    position_group: "G",
    player_type: "goalie",
    games_played: num(row.gamesPlayed),
    wins: num(row.wins),
    losses: num(row.losses),
    ties: num(row.ties),
    overtime_losses: num(row.otLosses),
    save_percentage: num(row.savePct),
    goals_against_average: num(row.goalsAgainstAverage),
    shutouts: num(row.shutouts),
    goals_against: num(row.goalsAgainst),
    shots_against: num(row.shotsAgainst),
    saves: num(row.saves),
    source: "nhl_stats_api",
  }, CLEAN_COLUMNS);
}

function withColumns(row, columns) {
  const output = {};
  for (const column of columns) {
    output[column] = row[column] ?? "";
  }
  return output;
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows, columns) {
  ensureDir(filePath);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!text) return [];
  const lines = text.split("\n");
  const columns = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? "";
    });
    return row;
  });
}

function assertColumns(rows, requiredColumns) {
  if (!Array.isArray(rows)) throw new Error("Rows must be an array");
  if (rows.length === 0) return;
  const missing = requiredColumns.filter((column) => !(column in rows[0]));
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }
}

function validateCleanRows(rows) {
  for (const row of rows) {
    if (numeric(row.games_played) < 40) throw new Error(`Invalid games_played for ${row.player_name}`);
    if (isBlank(row.player_id)) throw new Error("Blank player_id");
    if (isBlank(row.player_name)) throw new Error("Blank player_name");
    if (isBlank(row.season_id)) throw new Error("Blank season_id");
    if (isBlank(row.team)) throw new Error("Blank team");
    if (String(row.team).includes(",")) throw new Error(`Multi-team row kept: ${row.player_name}`);
    if (!["skater", "goalie"].includes(row.player_type)) throw new Error(`Invalid player_type: ${row.player_type}`);
    if (!["F", "D", "G"].includes(row.position_group)) throw new Error(`Invalid position_group: ${row.position_group}`);
  }
}

module.exports = {
  CLEAN_COLUMNS,
  ZSCORE_COLUMNS,
  SCORE_COLUMNS,
  GAME_VALUE_COLUMNS,
  assertColumns,
  numeric,
  normalizeGoalie,
  normalizeSkater,
  positionGroup,
  ratingGroup,
  readCsv,
  seasonIds,
  seasonLabel,
  validateCleanRows,
  withColumns,
  writeCsv,
};
