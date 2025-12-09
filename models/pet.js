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
        isPrimary: {
          type: Boolean,
          default: false,
        },
        autoCreated: {
          type: Boolean,
          default: false,
        },
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

// Virtual để lấy safe zone chính
petSchema.virtual("primarySafeZone").get(function () {
  if (!this.safeZones || this.safeZones.length === 0) return null;
  return this.safeZones.find((zone) => zone.isPrimary) || this.safeZones[0];
});

// Virtual để kiểm tra có safe zone không
petSchema.virtual("hasSafeZone").get(function () {
  return this.safeZones && this.safeZones.length > 0;
});

// Virtual để kiểm tra có safe zone tự động tạo không
petSchema.virtual("hasAutoCreatedSafeZone").get(function () {
  return this.safeZones && this.safeZones.some((zone) => zone.autoCreated);
});

// 🔥 THÊM VIRTUAL MỚI: Số lượng safe zones
petSchema.virtual("safeZonesCount").get(function () {
  return this.safeZones ? this.safeZones.length : 0;
});

// 🔥 THÊM VIRTUAL MỚI: Số lượng safe zones active
petSchema.virtual("activeSafeZonesCount").get(function () {
  return this.safeZones ? this.safeZones.filter((z) => z.isActive).length : 0;
});

// 🔥 THÊM VIRTUAL MỚI: Có quá nhiều safe zones không
petSchema.virtual("hasTooManySafeZones").get(function () {
  const MAX_SAFE_ZONES = 20;
  return this.safeZonesCount > MAX_SAFE_ZONES;
});

// Method to update last seen
petSchema.methods.updateLastSeen = function () {
  this.lastSeen = new Date();
  return this.save();
};

// Thêm safe zone với đánh dấu là chính
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

// Đặt safe zone làm chính
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

// 🔥 THÊM METHOD MỚI: Xóa safe zones cũ (giữ lại n mới nhất)
petSchema.methods.cleanupOldSafeZones = function (keepCount = 5) {
  if (!this.safeZones || this.safeZones.length <= keepCount) {
    return this; // Không cần dọn dẹp
  }

  // Sắp xếp theo thời gian tạo (mới nhất đầu tiên)
  this.safeZones.sort((a, b) => {
    const dateA = a.createdAt || a._id.getTimestamp();
    const dateB = b.createdAt || b._id.getTimestamp();
    return new Date(dateB) - new Date(dateA);
  });

  // Giữ lại chỉ keepCount safe zones mới nhất
  this.safeZones = this.safeZones.slice(0, keepCount);

  console.log(
    `🧹 Cleaned up safe zones for pet ${this.name}, kept ${keepCount} most recent`
  );

  return this.save();
};

// 🔥 THÊM METHOD MỚI: Kiểm tra và dọn dẹp tự động
petSchema.methods.autoCleanupIfNeeded = function () {
  const MAX_SAFE_ZONES = 20;
  const WARNING_THRESHOLD = 10;

  if (this.safeZonesCount > MAX_SAFE_ZONES) {
    console.warn(
      `⚠️ Pet ${this.name} has ${this.safeZonesCount} safe zones (max: ${MAX_SAFE_ZONES}). Auto-cleaning...`
    );
    return this.cleanupOldSafeZones(WARNING_THRESHOLD);
  }

  return Promise.resolve(this);
};

// Static method to find pets by owner
petSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId, isActive: true }).sort({ createdAt: -1 });
};

// Static method to find active pets
petSchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

// Tìm pets có safe zone
petSchema.statics.findWithSafeZones = function () {
  return this.find({
    "safeZones.0": { $exists: true }, // Có ít nhất 1 safe zone
    isActive: true,
  });
};

// Tìm pets có safe zone tự động tạo
petSchema.statics.findWithAutoCreatedSafeZones = function () {
  return this.find({
    "safeZones.autoCreated": true,
    isActive: true,
  });
};

// 🔥 THÊM STATIC METHOD MỚI: Tìm pets có quá nhiều safe zones
petSchema.statics.findWithTooManySafeZones = function (threshold = 10) {
  return this.aggregate([
    {
      $match: {
        isActive: true,
      },
    },
    {
      $addFields: {
        safeZonesCount: { $size: "$safeZones" },
      },
    },
    {
      $match: {
        safeZonesCount: { $gt: threshold },
      },
    },
    {
      $project: {
        name: 1,
        owner: 1,
        safeZonesCount: 1,
        safeZones: {
          $slice: ["$safeZones", 5], // Chỉ lấy 5 safe zones đầu tiên để xem
        },
      },
    },
  ]);
};

// 🔥 THÊM STATIC METHOD MỚI: Dọn dẹp safe zones cho tất cả pets
petSchema.statics.cleanupAllPetsSafeZones = async function (keepCount = 5) {
  try {
    const pets = await this.find({
      "safeZones.0": { $exists: true },
    });

    let cleanedCount = 0;
    const results = [];

    for (const pet of pets) {
      const beforeCount = pet.safeZones.length;
      if (beforeCount > keepCount) {
        await pet.cleanupOldSafeZones(keepCount);
        cleanedCount++;
        results.push({
          petId: pet._id,
          petName: pet.name,
          before: beforeCount,
          after: keepCount,
          deleted: beforeCount - keepCount,
        });
      }
    }

    return {
      totalPets: pets.length,
      cleanedCount,
      results,
    };
  } catch (error) {
    console.error("Error cleaning up all pets safe zones:", error);
    throw error;
  }
};

// Middleware to update lastSeen when petData is added
petSchema.pre("save", function (next) {
  if (this.isModified("lastSeen")) {
    this.lastSeen = new Date();
  }
  next();
});

// 🚨 QUAN TRỌNG: MIDDLEWARE ĐẢM BẢO CHỈ CÓ 1 SAFE ZONE CHÍNH
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

// 🚨 QUAN TRỌNG: MIDDLEWARE GIỚI HẠN SỐ LƯỢNG SAFE ZONES
petSchema.pre("save", function (next) {
  const MAX_SAFE_ZONES = 30; // Giới hạn cao hơn để không mất data đột ngột
  const WARNING_THRESHOLD = 10; // Ngưỡng cảnh báo

  if (this.safeZones && this.safeZones.length > MAX_SAFE_ZONES) {
    // Sắp xếp theo thời gian tạo (mới nhất đầu tiên)
    this.safeZones.sort((a, b) => {
      const dateA = a.createdAt || a._id.getTimestamp();
      const dateB = b.createdAt || b._id.getTimestamp();
      return new Date(dateB) - new Date(dateA);
    });

    // Giữ lại chỉ MAX_SAFE_ZONES zones mới nhất
    const zonesToKeep = this.safeZones.slice(0, MAX_SAFE_ZONES);
    const zonesToDelete = this.safeZones.slice(MAX_SAFE_ZONES);

    this.safeZones = zonesToKeep;

    console.warn(
      `⚠️ Auto-trimmed safe zones for pet ${this.name} from ${
        zonesToDelete.length + zonesToKeep.length
      } to ${MAX_SAFE_ZONES}`
    );
    console.warn(`   Deleted ${zonesToDelete.length} old safe zones`);

    // Ghi log chi tiết nếu cần
    if (zonesToDelete.length > 0) {
      zonesToDelete.forEach((zone, index) => {
        console.warn(
          `   ${index + 1}. ${zone.name} (${zone.radius}m) - ${
            zone.createdAt || "unknown date"
          }`
        );
      });
    }
  }

  // Cảnh báo nếu có quá nhiều safe zones (nhưng vẫn cho phép)
  if (this.safeZones && this.safeZones.length > WARNING_THRESHOLD) {
    console.warn(
      `⚠️ Pet ${this.name} has ${this.safeZones.length} safe zones (threshold: ${WARNING_THRESHOLD})`
    );
  }

  next();
});

// 🚨 THÊM MIDDLEWARE: Validate radius của safe zone
petSchema.pre("save", function (next) {
  if (this.safeZones) {
    for (const zone of this.safeZones) {
      if (zone.radius < 10) {
        zone.radius = 10; // Tự động sửa nếu radius quá nhỏ
        console.warn(
          `⚠️ Fixed safe zone radius for ${this.name}: ${zone.radius} -> 10m`
        );
      }
      if (zone.radius > 5000) {
        zone.radius = 5000; // Tự động sửa nếu radius quá lớn
        console.warn(
          `⚠️ Fixed safe zone radius for ${this.name}: ${zone.radius} -> 5000m`
        );
      }
    }
  }
  next();
});

module.exports = mongoose.model("Pet", petSchema);
