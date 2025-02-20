import mongoose from "mongoose";

const sleepAssessmentSchema = new mongoose.Schema({
  sleepType: { type: String, required: true },  // e.g., "side sleeper"
  preferredFirmness: String,  // "soft", "medium", "firm"
  recommendedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
});

export const SleepAssessment = mongoose.model("SleepAssessment", sleepAssessmentSchema);
