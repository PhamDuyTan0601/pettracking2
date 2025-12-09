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
    // ✅ CẬP NHẬT: Thêm validation cho safeZones + THÊM FIELD MỚI
    safeZones: [
      {
        name: {
          type: String,
          default: "Vùng an toàn",
        },
        center: {
          lat: {
            type: Number,
            required: true,
            min: -90,
            max: 90,
          },
          lng: {
            type: Number,
            required: true,
            min: -180,
            max: 180,
          },
        },
        radius: {
          type: Number,
          required: true,
          min: 10, // ít nhất 10m
          max: 5000, // tối đa 5km
          default: 100,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        // 🔥 THÊM FIELD MỚI: Đánh dấu đây là safe zone chính
        isPrimary: {
          type: Boolean,
          default: false,
        },
        // 🔥 THÊM FIELD MỚI: Đánh dấu được tạo tự động từ vị trí đầu tiên
        autoCreated: {
          type: Boolean,
          default: false,
        },
        // 🔥 THÊM FIELD MỚI: Ghi chú về safe zone
        notes: {
          type: String,
          maxlength: [200, "Notes cannot be more than 200 characters"],
          default: "",
        },
        createdAt: {
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

// Index for faster queries
petSchema.index({ owner: 1 });
petSchema.index({ species: 1 });
petSchema.index({ isActive: 1 });

// 🔥 THÊM INDEX MỚI: Để tìm safe zone chính nhanh hơn
petSchema.index({ "safeZones.isPrimary": 1 });
petSchema.index({ "safeZones.autoCreated": 1 });

// Virtual for pet's age in years
petSchema.virtual("ageInYears").get(function () {
  return this.age;
});

// Virtual for pet's age in months
petSchema.virtual("ageInMonths").get(function () {
  return this.age * 12;
});

// 🔥 THÊM VIRTUAL MỚI: Lấy safe zone chính
petSchema.virtual("primarySafeZone").get(function () {
  if (!this.safeZones || this.safeZones.length === 0) return null;
  return this.safeZones.find((zone) => zone.isPrimary) || this.safeZones[0];
});

// 🔥 THÊM VIRTUAL MỚI: Kiểm tra có safe zone không
petSchema.virtual("hasSafeZone").get(function () {
  return this.safeZones && this.safeZones.length > 0;
});

// 🔥 THÊM VIRTUAL MỚI: Kiểm tra có safe zone tự động tạo không
petSchema.virtual("hasAutoCreatedSafeZone").get(function () {
  return this.safeZones && this.safeZones.some((zone) => zone.autoCreated);
});

// Method to update last seen
petSchema.methods.updateLastSeen = function () {
  this.lastSeen = new Date();
  return this.save();
};

// 🔥 THÊM METHOD MỚI: Thêm safe zone với đánh dấu là chính
petSchema.methods.addPrimarySafeZone = function (
  center,
  radius = 100,
  name = "Vị trí an toàn chính"
) {
  if (!this.safeZones) this.safeZones = [];

  // Nếu đã có safe zone chính, bỏ đánh dấu cũ
  this.safeZones.forEach((zone) => {
    zone.isPrimary = false;
  });

  const newZone = {
    name,
    center,
    radius,
    isActive: true,
    isPrimary: true,
    autoCreated: false,
    notes: "Thêm thủ công bởi người dùng",
    createdAt: new Date(),
  };

  this.safeZones.push(newZone);
  return this.save();
};

// 🔥 THÊM METHOD MỚI: Đặt safe zone làm chính
petSchema.methods.setPrimarySafeZone = function (zoneId) {
  if (!this.safeZones || this.safeZones.length === 0) {
    throw new Error("Không có safe zone nào");
  }

  const zone = this.safeZones.id(zoneId);
  if (!zone) {
    throw new Error("Safe zone không tồn tại");
  }

  // Bỏ đánh dấu chính của tất cả safe zones
  this.safeZones.forEach((z) => {
    z.isPrimary = false;
  });

  // Đánh dấu safe zone được chọn là chính
  zone.isPrimary = true;
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

// 🔥 THÊM STATIC METHOD MỚI: Tìm pets có safe zone
petSchema.statics.findWithSafeZones = function () {
  return this.find({
    "safeZones.0": { $exists: true }, // Có ít nhất 1 safe zone
    isActive: true,
  });
};

// 🔥 THÊM STATIC METHOD MỚI: Tìm pets có safe zone tự động tạo
petSchema.statics.findWithAutoCreatedSafeZones = function () {
  return this.find({
    "safeZones.autoCreated": true,
    isActive: true,
  });
};

// Middleware to update lastSeen when petData is added
petSchema.pre("save", function (next) {
  if (this.isModified("lastSeen")) {
    this.lastSeen = new Date();
  }
  next();
});

// 🔥 THÊM MIDDLEWARE: Đảm bảo chỉ có 1 safe zone chính
petSchema.pre("save", function (next) {
  if (this.safeZones && this.safeZones.length > 0) {
    // Đếm số safe zone được đánh dấu là chính
    const primaryCount = this.safeZones.filter((zone) => zone.isPrimary).length;

    // Nếu có nhiều hơn 1 safe zone chính
    if (primaryCount > 1) {
      // Chỉ giữ lại safe zone đầu tiên làm chính
      let foundFirst = false;
      this.safeZones.forEach((zone) => {
        if (zone.isPrimary) {
          if (!foundFirst) {
            foundFirst = true;
          } else {
            zone.isPrimary = false;
          }
        }
      });
    }

    // Nếu không có safe zone chính nào, đặt safe zone đầu tiên làm chính
    if (primaryCount === 0 && this.safeZones.length > 0) {
      this.safeZones[0].isPrimary = true;
    }
  }
  next();
});

module.exports = mongoose.model("Pet", petSchema);
