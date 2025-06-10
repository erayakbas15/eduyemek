var routeMain = require("./mainRoute");
var routeAccount = require("./accountRoute");
var routeAdmin = require("./adminRoute");
var routeRestaurant = require("./restaurantRoute");

module.exports = function (app) {
  app.use("/", routeMain);
  app.use("/admin", routeAdmin);
  app.use("/account", routeAccount);
  app.use("/restaurant", routeRestaurant);
};
