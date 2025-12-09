const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: [true, "Device ID is required"],
      unique: true,
      trim: true,
    },
    petId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pet",
      required: [true, "Pet ID is required"],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    configSent: {
      type: Boolean,
      default: false,
    },
    lastConfigSent: {
      type: Date,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    description: {
      type: String,
      maxlength: [200, "Description too long"],
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

// Static method to find devices by owner
deviceSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId, isActive: true })
    .populate("petId", "name species")
    .sort({ lastSeen: -1 });
};

// Static method to find device by deviceId
deviceSchema.statics.findByDeviceId = function (deviceId) {
  return this.findOne({ deviceId, isActive: true }).populate("petId", "name");
};

module.exports = mongoose.model("Device", deviceSchema);
