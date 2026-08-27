const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },

    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "withdrawn"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  },
);

offerSchema.index(
  {
    taskId: 1,
    providerId: 1,
  },
  {
    unique: true,
  },
);

module.exports = mongoose.model("Offer", offerSchema);
