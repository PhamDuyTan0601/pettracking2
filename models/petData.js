const mongoose = require("mongoose");

const petDataSchema = new mongoose.Schema(
  {
    petId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pet",
      required: [true, "Pet ID is required"],
      index: true,
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
        type: [Number],
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
    // Chỉ lưu khi có giá trị thực
    altitude: {
      type: Number,
      default: null, // Thay đổi từ 0 thành null
    },
    accuracy: {
      type: Number,
      default: null, // Thay đổi từ 0 thành null
    },
    // MPU6050 Accelerometer data - chỉ lưu khi có
    accelX: { type: Number, default: null },
    accelY: { type: Number, default: null },
    accelZ: { type: Number, default: null },
    // MPU6050 Gyroscope data - chỉ lưu khi có
    gyroX: { type: Number, default: null },
    gyroY: { type: Number, default: null },
    gyroZ: { type: Number, default: null },
    // Device status
    batteryLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: null, // Thay đổi từ 100 thành null
    },
    signalStrength: {
      type: Number,
      default: null,
    },
    temperature: {
      type: Number,
      default: null,
    },
    isMoving: { type: Boolean, default: false },
    activityType: {
      type: String,
      enum: ["resting", "walking", "running", "playing", "unknown"],
      default: "unknown",
    },
    // Metadata từ database
    metadata: {
      ownerPhone: { type: String, default: null },
      safeZoneCount: { type: Number, default: 0 },
      deviceId: { type: String, default: null },
      safeZoneCheck: { type: Boolean, default: false },
      safeZoneName: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// === INDEXES ===
petDataSchema.index({ petId: 1, timestamp: -1 });
petDataSchema.index({ "location.coordinates": "2dsphere" });
petDataSchema.index({ "metadata.deviceId": 1 });

// === MIDDLEWARES ===
petDataSchema.pre("save", function (next) {
  // Chỉ tạo location nếu có cả lat và lng
  if (this.latitude && this.longitude) {
    this.location = {
      type: "Point",
      coordinates: [this.longitude, this.latitude],
    };
  }

  // Chỉ tính toán nếu có speed
  if (this.speed !== null && this.speed !== undefined) {
    this.isMoving = this.speed > 0.5;
  }

  // Chỉ tính activity type nếu có đủ dữ liệu
  if (this.speed !== null && this.speed !== undefined) {
    this.determineActivityType();
  }

  next();
});

// === VIRTUALS ===
petDataSchema.virtual("accelMagnitude").get(function () {
  if (this.accelX === null || this.accelY === null || this.accelZ === null) {
    return 0;
  }
  return Math.sqrt(this.accelX ** 2 + this.accelY ** 2 + this.accelZ ** 2);
});

petDataSchema.virtual("gyroMagnitude").get(function () {
  if (this.gyroX === null || this.gyroY === null || this.gyroZ === null) {
    return 0;
  }
  return Math.sqrt(this.gyroX ** 2 + this.gyroY ** 2 + this.gyroZ ** 2);
});

petDataSchema.virtual("activityLevel").get(function () {
  const baseLevel = this.speed ? Math.min(this.speed * 10, 50) : 0;
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

petDataSchema.methods.checkSafeZone = function (safeZones) {
  if (!this.location || !safeZones || safeZones.length === 0) {
    return { isInSafeZone: false, zoneName: null };
  }

  for (const zone of safeZones) {
    if (!zone.isActive || !zone.center || !zone.radius) continue;

    const distance = this.calculateDistance(
      this.latitude,
      this.longitude,
      zone.center.lat,
      zone.center.lng
    );

    if (distance <= zone.radius) {
      return {
        isInSafeZone: true,
        zoneName: zone.name || "Safe Zone",
        distance: distance,
      };
    }
  }

  return { isInSafeZone: false, zoneName: null };
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

module.exports = mongoose.model("PetData", petDataSchema);
