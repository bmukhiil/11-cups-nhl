const fs = require("node:fs");
const path = require("node:path");
const { readCsv, numeric } = require("../scripts/pipeline_common");

const ROOT = path.join(__dirname, "..");
const GENERATED_CARD_PATH = path.join(__dirname, "data", "cards.generated.json");
const ENRICHED_CARD_PATH = path.join(ROOT, "data", "team_board_pools_hockey_reference_enriched.csv");
const RAW_CARD_PATH = path.join(ROOT, "data", "team_board_pools_hockey_reference_raw.csv");

function normalizeCard(row) {
  return {
    ...row,
    raw_card_ps: numeric(row.raw_card_ps),
    raw_card_ops: row.raw_card_ops === "" ? "" : numeric(row.raw_card_ops),
    raw_card_dps: row.raw_card_dps === "" ? "" : numeric(row.raw_card_dps),
    raw_card_gps: row.raw_card_gps === "" ? "" : numeric(row.raw_card_gps),
  };
}

function rowsToStore(cards, source) {
  const cardById = new Map();
  const byTeam = new Map();
  for (const card of cards) {
    cardById.set(card.card_id, card);
    const teamCards = byTeam.get(card.franchise_key) || [];
    teamCards.push(card);
    byTeam.set(card.franchise_key, teamCards);
  }
  const teams = [...byTeam.keys()].sort();
  return { source, cards, cardById, byTeam, teams };
}

function loadGeneratedStore(filePath = GENERATED_CARD_PATH) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const cards = data.cards.map(normalizeCard);
  return rowsToStore(cards, path.relative(ROOT, filePath));
}

function loadCsvStore() {
  const csvPath = fs.existsSync(ENRICHED_CARD_PATH) ? ENRICHED_CARD_PATH : RAW_CARD_PATH;
  const cards = readCsv(csvPath)
    .filter((row) => row.card_id && row.franchise_key && row.raw_card_ps !== "")
    .map(normalizeCard);
  return rowsToStore(cards, path.relative(ROOT, csvPath));
}

function loadCardStore() {
  if (fs.existsSync(GENERATED_CARD_PATH)) {
    return loadGeneratedStore(GENERATED_CARD_PATH);
  }
  return loadCsvStore();
}

module.exports = {
  GENERATED_CARD_PATH,
  loadCardStore,
  loadGeneratedStore,
  loadCsvStore,
  rowsToStore,
};
