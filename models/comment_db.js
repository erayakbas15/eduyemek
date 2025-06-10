const mongoose = require("../mongodb");

const commentSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Restaurant",
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order", // Sipariş referansı
    required: false, // Opsiyonel, genel restoran yorumları için
  },
  mealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Meal",
    required: false, // Mevcut alanı koruyoruz
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  text: {
    type: String,
    default: "",
    maxlength: [300, "Yorum 300 karakterden uzun olamaz"],
  },
  reply: {
    type: String,
    default: "",
    maxlength: [300, "Yanıt 300 karakterden uzun olamaz"],
  },
  repliedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Comment", commentSchema);  