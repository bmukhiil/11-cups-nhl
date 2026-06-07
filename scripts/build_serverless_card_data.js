const fs = require("node:fs");
const path = require("node:path");
const { readCsv, numeric } = require("./pipeline_common");

const ROOT = path.join(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data", "team_board_pools_hockey_reference_enriched.csv");
const FALLBACK_INPUT = path.join(ROOT, "data", "team_board_pools_hockey_reference_raw.csv");
const DEFAULT_OUTPUT = path.join(ROOT, "app", "data", "cards.generated.json");
const HANDEDNESS_INPUT = path.join(ROOT, "data", "player_handedness.csv");
const NHL_HEADSHOT_PUBLIC_DIR = path.join(ROOT, "app", "public", "player-headshots");
const HR_HEADSHOT_PUBLIC_DIR = path.join(ROOT, "app", "public", "headshots");

function parseArgs(argv) {
  const args = {
    input: fs.existsSync(DEFAULT_INPUT) ? DEFAULT_INPUT : FALLBACK_INPUT,
    output: DEFAULT_OUTPUT,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--input") {
      args.input = path.resolve(value);
      index += 1;
    } else if (arg === "--output") {
      args.output = path.resolve(value);
      index += 1;
    }
  }
  return args;
}

function loadPlayerImageIndex() {
  const byHrPlayerId = new Map();
  if (fs.existsSync(HANDEDNESS_INPUT)) {
    for (const row of readCsv(HANDEDNESS_INPUT)) {
      if (!row.hr_player_id) continue;
      byHrPlayerId.set(row.hr_player_id, {
        nhlPlayerId: row.nhl_player_id || "",
      });
    }
  }
  return byHrPlayerId;
}

function localHeadshotFor(row, imageIndex) {
  const imageInfo = imageIndex.get(row.player_id) || {};
  const nhlPlayerId = imageInfo.nhlPlayerId || "";
  if (nhlPlayerId && fs.existsSync(path.join(NHL_HEADSHOT_PUBLIC_DIR, `${nhlPlayerId}.png`))) {
    return {
      nhl_player_id: nhlPlayerId,
      headshot_url: `/player-headshots/${nhlPlayerId}.png`,
      headshot_source: "nhl",
    };
  }
  if (fs.existsSync(path.join(HR_HEADSHOT_PUBLIC_DIR, `${row.player_id}.jpg`))) {
    return {
      nhl_player_id: nhlPlayerId,
      headshot_url: `/headshots/${row.player_id}.jpg`,
      headshot_source: "hockey_reference",
    };
  }
  return {
    nhl_player_id: nhlPlayerId,
    headshot_url: "",
    headshot_source: "",
  };
}

function normalizeCard(row) {
  const imageIndex = normalizeCard.imageIndex || new Map();
  return {
    ...row,
    ...localHeadshotFor(row, imageIndex),
    raw_card_ps: numeric(row.raw_card_ps),
    raw_card_ops: row.raw_card_ops === "" ? "" : numeric(row.raw_card_ops),
    raw_card_dps: row.raw_card_dps === "" ? "" : numeric(row.raw_card_dps),
    raw_card_gps: row.raw_card_gps === "" ? "" : numeric(row.raw_card_gps),
  };
}

function buildCardData(inputPath) {
  normalizeCard.imageIndex = loadPlayerImageIndex();
  const cards = readCsv(inputPath)
    .filter((row) => row.card_id && row.franchise_key && row.raw_card_ps !== "")
    .map(normalizeCard);
  const teams = [...new Set(cards.map((card) => card.franchise_key))].sort();
  const byTeam = {};
  for (const team of teams) byTeam[team] = [];
  for (const card of cards) byTeam[card.franchise_key].push(card.card_id);
  return {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, inputPath),
    cardCount: cards.length,
    teamCount: teams.length,
    cards,
    teams,
    byTeam,
  };
}

function writeCardData({ input, output }) {
  const data = buildCardData(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data)}\n`);
  console.log(`Wrote ${data.cardCount} cards across ${data.teamCount} teams to ${path.relative(ROOT, output)}`);
  return data;
}

if (require.main === module) {
  writeCardData(parseArgs(process.argv));
}

module.exports = {
  buildCardData,
  writeCardData,
};
