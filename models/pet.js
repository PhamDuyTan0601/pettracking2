const mongoose = require("mongoose");

const petSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Pet name is required"],
      trim: true,
      maxlength: [50, "Name cannot be more than 50 characters"],
    },
    species: {
      type: String,
      required: [true, "Species is required"],
      enum: {
        values: ["dog", "cat", "bird", "rabbit", "other"],
        message: "Species must be dog, cat, bird, rabbit, or other",
      },
    },
    breed: {
      type: String,
      required: [true, "Breed is required"],
      trim: true,
      maxlength: [50, "Breed cannot be more than 50 characters"],
    },
    age: {
      type: Number,
      required: [true, "Age is required"],
      min: [0, "Age must be a positive number"],
      max: [50, "Age seems unrealistic"],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required"],
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot be more than 500 characters"],
      default: "",
    },
    color: {
      type: String,
      trim: true,
      default: "",
    },
    weight: {
      type: Number,
      min: [0.1, "Weight must be greater than 0"],
      max: [100, "Weight seems unrealistic"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    safeZones: [
      {
        name: String,
        center: {
          lat: Number,
          lng: Number,
        },
        radius: Number, // in meters
        isActive: Boolean,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
petSchema.index({ owner: 1 });
petSchema.index({ species: 1 });
petSchema.index({ isActive: 1 });

// Virtual for pet's age in years
petSchema.virtual("ageInYears").get(function () {
  return this.age;
});

// Virtual for pet's age in months
petSchema.virtual("ageInMonths").get(function () {
  return this.age * 12;
});

// Method to update last seen
petSchema.methods.updateLastSeen = function () {
  this.lastSeen = new Date();
  return this.save();
};

// Static method to find pets by owner
petSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId, isActive: true }).sort({ createdAt: -1 });
};

// Static method to find active pets
petSchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

// Middleware to update lastSeen when petData is added
petSchema.pre("save", function (next) {
  if (this.isModified("lastSeen")) {
    this.lastSeen = new Date();
  }
  next();
});

module.exports = mongoose.model("Pet", petSchema);
