import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  sizes: [String],
  materials: [String],
  basePrice: Number,
  features: [String],
  category: String,
  image: String
});

export const Product = mongoose.model("Product", productSchema);
