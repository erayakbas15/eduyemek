const mongoose = require("../mongodb");

const logSchema = new mongoose.Schema({
  action: String,
  actionType: { type: String, enum: ['added', 'updated', 'deleted'], default: 'added' }, // 👈 BU ŞART!
  description: String,
  user: { type: String, default: 'Sistem' },
  role: { type: String, enum: ['student', 'admin', 'rest_owner'], default: 'student' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Log", logSchema);
