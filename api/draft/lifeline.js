const { handleRoute, useLifelineAction } = require("../../app/serverlessRoute");

module.exports = (req, res) => handleRoute(req, res, {
  route: "lifeline",
  methods: ["POST"],
  fields: ["draftToken", "type", "position"],
  action: async ({ body, store }) => useLifelineAction({
    store,
    draftToken: body.draftToken,
    type: body.type,
    position: body.position,
  }),
});
