const mongoose = require("mongoose");

const petSchema = new mongoose.Schema(
  {
    // ... (các field khác giữ nguyên)

    safeZones: [
      {
        name: {
          type: String,
          default: "Safe Zone",
        },
        center: {
          lat: {
            type: Number,
            required: [true, "Latitude is required for safe zone"],
          },
          lng: {
            type: Number,
            required: [true, "Longitude is required for safe zone"],
          },
        },
        radius: {
          type: Number,
          required: [true, "Radius is required for safe zone"],
          min: [10, "Radius must be at least 10 meters"],
          max: [5000, "Radius cannot exceed 5000 meters"],
          default: 100,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ... (phần dưới giữ nguyên)

module.exports = mongoose.model("Pet", petSchema);
