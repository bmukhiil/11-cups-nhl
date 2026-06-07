const { handleRoute, startDraftAction } = require("../../app/serverlessRoute");

module.exports = (req, res) => handleRoute(req, res, {
  route: "start",
  methods: ["POST"],
  fields: [],
  action: async ({ store }) => startDraftAction({ store }),
});
