const mongoose = require("../mongodb");

const mealSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '/uploads/default-meal.jpg' },
  category: { type: String, default: 'Ana Yemek' },
  available: { type: Boolean, default: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Meal", mealSchema);
