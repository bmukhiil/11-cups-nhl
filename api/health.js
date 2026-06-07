const { handleRoute, store } = require("../app/serverlessRoute");

module.exports = (req, res) => handleRoute(req, res, {
  route: "health",
  methods: ["GET"],
  action: async () => ({
    ok: true,
    cards: store.cards.length,
    teams: store.teams.length,
    mode: "stateless",
    source: store.source,
  }),
});
