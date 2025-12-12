const mongoose = require("mongoose");

const petDataSchema = new mongoose.Schema(
  {
    petId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pet",
      required: [true, "Pet ID is required"],
      index: true, // giữ index đơn cho petId nếu muốn query riêng
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        // bỏ index: "2dsphere" trực tiếp, dùng schema.index() bên dưới
      },
    },
    latitude: {
      type: Number,
      required: [true, "Latitude is required"],
      min: [-90, "Latitude must be between -90 and 90"],
      max: [90, "Latitude must be between -90 and 90"],
    },
    longitude: {
      type: Number,
      required: [true, "Longitude is required"],
      min: [-180, "Longitude must be between -180 and 180"],
      max: [180, "Longitude must be between -180 and 180"],
    },
    speed: {
      type: Number,
      min: [0, "Speed cannot be negative"],
      max: [200, "Speed seems unrealistic"],
      default: 0,
    },
    altitude: {
      type: Number,
      default: 0,
    },
    accuracy: {
      type: Number,
      default: 0,
    },
    // MPU6050 Accelerometer data
    accelX: { type: Number, default: 0 },
    accelY: { type: Number, default: 0 },
    accelZ: { type: Number, default: 0 },
    // MPU6050 Gyroscope data
    gyroX: { type: Number, default: 0 },
    gyroY: { type: Number, default: 0 },
    gyroZ: { type: Number, default: 0 },
    // Device status
    batteryLevel: { type: Number, min: 0, max: 100, default: 100 },
    signalStrength: { type: Number, default: 0 },
    temperature: { type: Number, default: 0 },
    isMoving: { type: Boolean, default: false },
    activityType: {
      type: String,
      enum: ["resting", "walking", "running", "playing", "unknown"],
      default: "unknown",
    },
  },
  {
    timestamps: true,
  }
);

// === INDEXES ===
// Compound index: query nhanh theo petId và timestamp
petDataSchema.index({ petId: 1, timestamp: -1 });

// 2dsphere index cho location
petDataSchema.index({ "location.coordinates": "2dsphere" });

// === MIDDLEWARES ===
petDataSchema.pre("save", function (next) {
  if (this.latitude && this.longitude) {
    this.location = {
      type: "Point",
      coordinates: [this.longitude, this.latitude],
    };
  }

  this.isMoving = this.speed > 0.5;
  this.determineActivityType();
  next();
});

// === VIRTUALS ===
petDataSchema.virtual("accelMagnitude").get(function () {
  return Math.sqrt(this.accelX ** 2 + this.accelY ** 2 + this.accelZ ** 2);
});

petDataSchema.virtual("gyroMagnitude").get(function () {
  return Math.sqrt(this.gyroX ** 2 + this.gyroY ** 2 + this.gyroZ ** 2);
});

petDataSchema.virtual("activityLevel").get(function () {
  const baseLevel = Math.min(this.speed * 10, 50);
  const accelLevel = Math.min(this.accelMagnitude * 20, 30);
  const gyroLevel = Math.min(this.gyroMagnitude * 10, 20);
  return Math.min(baseLevel + accelLevel + gyroLevel, 100);
});

// === METHODS ===
petDataSchema.methods.determineActivityType = function () {
  if (this.speed < 0.1) this.activityType = "resting";
  else if (this.speed < 2) this.activityType = "walking";
  else if (this.speed < 5) this.activityType = "running";
  else this.activityType = "playing";

  if (this.accelMagnitude > 2.5) this.activityType = "playing";
};

petDataSchema.methods.calculateDistance = function (lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

petDataSchema.methods.isInSafeZone = function (safeZones) {
  if (!this.location) return false;
  return safeZones.some((zone) => {
    const distance = this.calculateDistance(
      this.latitude,
      this.longitude,
      zone.center.lat,
      zone.center.lng
    );
    return distance <= zone.radius && zone.isActive;
  });
};

// === STATIC METHODS ===
petDataSchema.statics.getLatestData = function (petId) {
  return this.findOne({ petId }).sort({ timestamp: -1 });
};

petDataSchema.statics.getDataInRange = function (petId, startDate, endDate) {
  return this.find({
    petId,
    timestamp: { $gte: startDate, $lte: endDate },
  }).sort({ timestamp: 1 });
};

petDataSchema.statics.getDailyStats = function (petId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        petId: mongoose.Types.ObjectId(petId),
        timestamp: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: null,
        totalPoints: { $sum: 1 },
        avgSpeed: { $avg: "$speed" },
        maxSpeed: { $max: "$speed" },
        totalDistance: { $sum: "$speed" },
        avgActivity: { $avg: "$activityLevel" },
        activityTypes: { $push: "$activityType" },
      },
    },
  ]);
};

petDataSchema.statics.findNearbyPoints = function (
  latitude,
  longitude,
  radiusInMeters
) {
  return this.find({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [longitude, latitude] },
        $maxDistance: radiusInMeters,
      },
    },
  });
};

module.exports = mongoose.model("PetData", petDataSchema);
