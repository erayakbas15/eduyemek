require("dotenv").config();
const mongoose = require('mongoose')

mongoose.connect(process.env.MONGO_URI)

    .then(() => console.log("MongoDB connected successfully"))
    .catch(err => console.error("MongoDB connection failed:", err));

module.exports = mongoose