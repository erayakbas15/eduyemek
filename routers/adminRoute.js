const express = require("express");
var router = express.Router();
var ctrlAdmin = require("../controllers/adminController");
const { verifyToken, verifyAdminToken } = require("../middlewares/auth");

router.get("/dashboard", verifyAdminToken, ctrlAdmin.adminDashboard);
router.get("/users", verifyAdminToken, ctrlAdmin.adminUsers);
router.get("/restaurants", verifyAdminToken, ctrlAdmin.adminRestaurants);
router.get("/meals", verifyAdminToken, ctrlAdmin.adminMeals);
router.get("/orders", verifyAdminToken, ctrlAdmin.adminOrders);


router.get("/meals/restaurants", verifyAdminToken, ctrlAdmin.getRestaurantsForFilter); 
router.get("/users/:id", verifyAdminToken, ctrlAdmin.getUserById); 
router.delete("/users/:id", verifyAdminToken, ctrlAdmin.deleteUser); 
router.post("/restaurants", verifyAdminToken, ctrlAdmin.createRestaurant);

router.delete("/restaurants/:id", verifyAdminToken, ctrlAdmin.deleteRestaurant);

router.put("/restaurants/:id", verifyAdminToken, (req, res, next) => {
  console.log("✅ PUT /admin/restaurants/:id çalıştı");
  next();
}, ctrlAdmin.updateRestaurant);

router.post("/meals", verifyAdminToken, ctrlAdmin.createMeal);
router.put('/users/:id', verifyAdminToken, ctrlAdmin.updateUser);

router.get("/restaurants/:id", verifyAdminToken, ctrlAdmin.getRestaurantById);

router.put("/meals/:id", verifyAdminToken, ctrlAdmin.updateMeal);
router.delete("/meals/:id", verifyAdminToken, ctrlAdmin.deleteMeal);
router.get("/meals/:id", verifyAdminToken, ctrlAdmin.getMealById);
module.exports = router;