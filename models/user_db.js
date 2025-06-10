const mongoose = require("../mongodb");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String, default: null },
  lastName: { type: String, default: null },
  phone: { type: String, default: null },
  selectedAddressId: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', default: null },
  isVerified: { type: Boolean, default: false },
  role: { type: String, enum: ['student', 'admin', 'rest_owner'], default: 'student' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);