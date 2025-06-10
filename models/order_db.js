const mongoose = require("../mongodb");

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Restaurant",
    required: true,
  },
  items: [
    {
      mealId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Meal",
        required: true,
      },
      name: String,
      quantity: { type: Number, default: 1 },
      price: Number,
    },
  ],
  totalPrice: { type: Number, required: true },
  deliveryAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Address",
    required: true,
  },
  deliveryAddressDetails: {
    // New field to store static address details
    formatted_address: { type: String, required: true },
    title: { type: String, default: "" },
    address: { type: String, default: "" },
  },
  status: {
    type: String,
    enum: ["pending", "preparing", "on_the_way", "delivered", "cancelled"],
    default: "pending",
  },
  orderNumber: { type: Number, unique: true, required: true },
  createdAt: { type: Date, default: Date.now },
  note: { type: String, default: "" },
  paymentMethod: {
    type: String,
    enum: ["credit_card", "cash", "online_payment", "wallet"],
    required: true,
  },
  hasComment: {
    type: Boolean,
    default: false,
  },
});

// Yeni siparişler için orderNumber'ı otomatik ayarlama
orderSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      console.log("pre(save) hook triggered for new order");
      // En yüksek orderNumber'ı bul
      const lastOrder = await this.constructor
        .findOne()
        .sort({ orderNumber: -1 });
      const nextOrderNumber =
        lastOrder && lastOrder.orderNumber ? lastOrder.orderNumber + 1 : 1;
      console.log(`Assigning orderNumber: ${nextOrderNumber}`);
      this.orderNumber = nextOrderNumber;
    } catch (error) {
      console.error("Error in pre(save) hook:", error);
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model("Order", orderSchema);
