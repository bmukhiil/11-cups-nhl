const path = require("node:path");
const { readCsv, writeCsv } = require("./pipeline_common");

function parseArgs(argv) {
  const args = {
    input: path.join("data", "game_subset_player_seasons.csv"),
    map: path.join("data", "franchise_map.csv"),
    output: path.join("data", "game_subset_player_seasons_enriched.csv"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--input") {
      args.input = value;
      i += 1;
    } else if (arg === "--map") {
      args.map = value;
      i += 1;
    } else if (arg === "--output") {
      args.output = value;
      i += 1;
    }
  }
  return args;
}

function enrichFranchiseFields(options) {
  const rows = readCsv(options.input);
  const mapRows = readCsv(options.map);
  const franchiseByTeam = new Map(mapRows.map((row) => [row.team, row]));

  const missingTeams = [...new Set(rows.map((row) => row.team))]
    .filter((team) => !franchiseByTeam.has(team))
    .sort();
  if (missingTeams.length > 0) {
    throw new Error(`Missing franchise mappings for teams: ${missingTeams.join(", ")}`);
  }

  const outputColumns = [
    ...Object.keys(rows[0] || {}),
    "historical_team",
    "team_name",
    "franchise_key",
    "franchise_name",
    "current_team",
    "franchise_status",
  ];

  const enriched = rows.map((row) => {
    const mapped = franchiseByTeam.get(row.team);
    return {
      ...row,
      historical_team: row.team,
      team_name: mapped.team_name,
      franchise_key: mapped.franchise_key,
      franchise_name: mapped.franchise_name,
      current_team: mapped.current_team,
      franchise_status: mapped.franchise_status,
    };
  });

  writeCsv(options.output, enriched, outputColumns);
  console.log(`Wrote ${enriched.length} rows to ${options.output}`);
  return enriched;
}

if (require.main === module) {
  enrichFranchiseFields(parseArgs(process.argv));
}

module.exports = { enrichFranchiseFields };
