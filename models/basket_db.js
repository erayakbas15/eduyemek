const mongoose = require("../mongodb");

const basketSchema = new mongoose.Schema({
  uid: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  restaurantName: { type: String },
  items: [
    {
      mealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meal' },
      name: String,
      quantity: { type: Number, default: 1 },
      price: Number
    }
  ],
  totalPrice: { type: Number, default: 0 },
  note: { type: String, default: "" }
});

// Calculate totalPrice before saving
basketSchema.pre('save', function(next) {
  this.totalPrice = this.items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0).toFixed(2);
  next();
});

module.exports = mongoose.model("Basket", basketSchema);