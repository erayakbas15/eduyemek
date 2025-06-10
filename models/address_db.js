const mongoose = require("../mongodb");

const addressSchema = new mongoose.Schema({
  uid: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  address: { type: String, required: true },
  formatted_address: { type: String, default: '' },
  coordinates: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Address", addressSchema);