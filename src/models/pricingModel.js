import mongoose from "mongoose";

const pricingSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  basePrice: Number,
  discountPercentage: Number,
  finalPrice: Number,
  updatedAt: { type: Date, default: Date.now }
});

export const Pricing = mongoose.model("Pricing", pricingSchema);
