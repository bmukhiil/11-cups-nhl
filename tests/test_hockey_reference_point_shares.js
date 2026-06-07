const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBoardPools,
  parseGoalieRows,
  parseSkaterRows,
  scoreWindow,
} = require("../scripts/build_hockey_reference_point_shares");

function season(overrides) {
  return {
    player_id: "test01",
    player_name: "Test Player",
    season: "2020-21",
    season_id: 20202021,
    age: 25,
    team: "PIT",
    league: "NHL",
    position: "C",
    position_group: "F",
    games_played: 82,
    raw_ps: 10,
    raw_ops: 7,
    raw_dps: 3,
    raw_gps: "",
    ...overrides,
  };
}

test("skater parser extracts Hockey-Reference point share fields", () => {
  const html = `
    <table><tbody>
      <tr>
        <td data-stat="name_display" data-append-csv="mcdavco01"><a>Connor McDavid</a></td>
        <td data-stat="age">27</td>
        <td data-stat="team_name_abbr">EDM</td>
        <td data-stat="pos">C</td>
        <td data-stat="games">76</td>
        <td data-stat="goals_adjusted">64</td>
        <td data-stat="assists_adjusted">89</td>
        <td data-stat="points_adjusted">153</td>
        <td data-stat="plus_minus">22</td>
        <td data-stat="ops">13.2</td>
        <td data-stat="dps">2.1</td>
        <td data-stat="ps">15.3</td>
      </tr>
    </tbody></table>`;

  const rows = parseSkaterRows(html, 2024);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_id, "mcdavco01");
  assert.equal(rows[0].season, "2023-24");
  assert.equal(rows[0].position_group, "F");
  assert.equal(rows[0].raw_ps, 15.3);
  assert.equal(rows[0].raw_ops, 13.2);
  assert.equal(rows[0].raw_dps, 2.1);
});

test("goalie parser uses goalie point shares as raw PS backbone", () => {
  const html = `
    <table><tbody>
      <tr>
        <td data-stat="name_display" data-append-csv="shestig01"><a>Igor Shesterkin</a></td>
        <td data-stat="age">28</td>
        <td data-stat="team_name_abbr">NYR</td>
        <td data-stat="goalie_games">55</td>
        <td data-stat="goalie_starts">55</td>
        <td data-stat="goalie_wins">36</td>
        <td data-stat="goalie_losses">17</td>
        <td data-stat="save_pct_goalie">.912</td>
        <td data-stat="goals_against_avg">2.58</td>
        <td data-stat="gps">10.1</td>
      </tr>
    </tbody></table>`;

  const rows = parseGoalieRows(html, 2024);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].position_group, "G");
  assert.equal(rows[0].ps, 10.1);
  assert.equal(rows[0].raw_ps, 10.1);
  assert.equal(rows[0].raw_gps, 10.1);
});

test("card window score uses best three eligible seasons with 50/30/20 weights", () => {
  const rows = [
    season({ season_id: 20192020, season: "2019-20", raw_ps: 5 }),
    season({ season_id: 20202021, season: "2020-21", raw_ps: 10 }),
    season({ season_id: 20212022, season: "2021-22", raw_ps: 7 }),
    season({ season_id: 20222023, season: "2022-23", raw_ps: 12 }),
  ];

  const score = scoreWindow(rows);

  assert.deepEqual(score.selected.map((row) => row.season), ["2022-23", "2020-21", "2021-22"]);
  assert.equal(score.raw_card_ps, 10.4);
});

test("board pool columns keep franchise key as a single output field", () => {
  const card = {
    card_id: "test01-PIT-peak-2020-21",
    player_id: "test01",
    player_name: "Test Player",
    position_group: "F",
    position: "C",
    franchise_key: "PIT",
    historical_team: "PIT",
    team_name: "Pittsburgh Penguins",
    franchise_name: "Pittsburgh Penguins",
    current_team: "PIT",
    franchise_status: "active",
    card_type: "peak",
    card_label: "2020-21",
    start_season: 20202021,
    end_season: 20202021,
    selected_seasons: "2020-21",
    season_count: 1,
    games_played_total: 82,
    raw_card_ps: 10,
    raw_card_ops: 7,
    raw_card_dps: 3,
    raw_card_gps: "",
    era_bucket: "2020s",
    is_legend: "false",
    is_modern: "true",
    source: "hockey_reference_point_shares",
  };

  const rows = buildBoardPools([card], { targetCardsPerFranchise: 1, maxCardsPerPlayerFranchise: 3 }, "data/franchise_map.csv");

  assert.equal(rows.some((row) => row.franchise_key === "PIT"), true);
  assert.equal(rows.find((row) => row.franchise_key === "PIT").card_id, card.card_id);
});

test("board pool fills historical target before modern remainder", () => {
  function card(index, eraBucket, endSeason, rawCardPs) {
    return {
      card_id: `test${index}-PIT-peak-${endSeason}`,
      player_id: `test${index}`,
      player_name: `Test Player ${index}`,
      position_group: "F",
      position: "C",
      franchise_key: "PIT",
      historical_team: "PIT",
      team_name: "Pittsburgh Penguins",
      franchise_name: "Pittsburgh Penguins",
      current_team: "PIT",
      franchise_status: "active",
      card_type: "peak",
      card_label: String(endSeason),
      start_season: endSeason,
      end_season: endSeason,
      selected_seasons: String(endSeason),
      season_count: 1,
      games_played_total: 82,
      raw_card_ps: rawCardPs,
      raw_card_ops: rawCardPs,
      raw_card_dps: 0,
      raw_card_gps: "",
      era_bucket: eraBucket,
      is_legend: "false",
      is_modern: eraBucket === "2020s" ? "true" : "false",
      source: "hockey_reference_point_shares",
    };
  }

  const cards = [
    card(1, "1990s", 19981999, 7),
    card(2, "1980s", 19881989, 6),
    card(3, "1970s", 19781979, 5),
    card(4, "2020s", 20232024, 15),
    card(5, "2020s", 20222023, 14),
    card(6, "2010s", 20182019, 13),
    card(7, "2010s", 20172018, 12),
  ];

  const rows = buildBoardPools(cards, {
    targetCardsPerFranchise: 6,
    historicalTargetPerFranchise: 3,
    historicalCutoffEndYear: 2000,
    maxCardsPerPlayerFranchise: 3,
    maxCardsPerPlayerTotal: 4,
  }, "data/franchise_map.csv");

  const pitRows = rows.filter((row) => row.franchise_key === "PIT");
  const historicalRows = pitRows.filter((row) => Number(row.end_season) < 20000000);

  assert.equal(pitRows.length, 6);
  assert.equal(historicalRows.length, 3);
});
