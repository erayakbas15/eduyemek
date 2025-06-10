const mongoose = require("../mongodb");

const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  address: { type: String, default: "" },
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  ownerPhone: { type: String, default: "" },

  openingHours: {
    open: { type: String, default: "09:00" },
    close: { type: String, default: "21:00" },
    daysOpen: {
      monday: { type: Boolean, default: true },
      tuesday: { type: Boolean, default: true },
      wednesday: { type: Boolean, default: true },
      thursday: { type: Boolean, default: true },
      friday: { type: Boolean, default: true },
      saturday: { type: Boolean, default: true },
      sunday: { type: Boolean, default: false },
    },
  },

  delivery: {
    case: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
    estimatedTime: { type: String, default: "30-45 dk" },
    minOrderAmount: { type: Number, default: 0 },
  },

  rating: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },

  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  createdAt: { type: Date, default: Date.now },

  imageUrl: { type: String, default: "/uploads/lahmacun.png" },

  location: {
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 },
  },
});

module.exports = mongoose.model("Restaurant", restaurantSchema);
