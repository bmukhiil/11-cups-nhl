const { handleRoute, selectCardAction } = require("../../app/serverlessRoute");

module.exports = (req, res) => handleRoute(req, res, {
  route: "select",
  methods: ["POST"],
  fields: ["draftToken", "cardId"],
  action: async ({ body, store }) => selectCardAction({
    store,
    draftToken: body.draftToken,
    cardId: body.cardId,
  }),
});
