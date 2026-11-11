const { handleRoute, startDraftAction } = require("../../app/serverlessRoute");

module.exports = (req, res) => handleRoute(req, res, {
  route: "start",
  methods: ["POST"],
  fields: ["friendCode"],
  action: async ({ body, store }) => startDraftAction({ store, friendCode: body.friendCode }),
});
