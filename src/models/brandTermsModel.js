import mongoose from "mongoose";

const brandTermSchema = new mongoose.Schema({
  term: { type: String, required: true, unique: true },
  definition: { type: String, required: true }
});

export const BrandTerm = mongoose.model("BrandTerm", brandTermSchema);
