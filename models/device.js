const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: [true, "Device ID is required"],
      unique: true,
      trim: true,
      index: true,
    },
    petId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pet",
      required: [true, "Pet ID is required"], // ⭐ QUAN TRỌNG
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner is required"], // ⭐ QUAN TRỌNG
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    batteryLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    signalStrength: {
      type: Number,
      default: null,
    },
    firmwareVersion: {
      type: String,
      default: "1.0.0",
    },
    description: {
      type: String,
      maxlength: [200, "Description too long"],
      default: "",
    },
    fixedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
deviceSchema.index({ deviceId: 1 });
deviceSchema.index({ owner: 1 });
deviceSchema.index({ petId: 1 });
deviceSchema.index({ isActive: 1 });
deviceSchema.index({ lastSeen: -1 });

// Static method to find devices by owner
deviceSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId, isActive: true })
    .populate("petId", "name species")
    .sort({ lastSeen: -1 });
};

// Static method to find device by deviceId
deviceSchema.statics.findByDeviceId = function (deviceId) {
  return this.findOne({ deviceId, isActive: true }).populate({
    path: "petId",
    populate: {
      path: "owner",
      select: "phone name",
    },
  });
};

// Method to check if device is valid
deviceSchema.methods.isValid = function () {
  return this.petId && this.owner && this.isActive;
};

module.exports = mongoose.model("Device", deviceSchema);
