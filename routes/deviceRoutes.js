const express = require("express");
const Device = require("../models/device");
const Pet = require("../models/pet");
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// ==============================
// 🔧 Đăng ký device với pet - THÊM VALIDATION
// ==============================
router.post("/register", auth, async (req, res) => {
  try {
    const { deviceId, petId } = req.body;

    console.log("📱 Device registration:", { deviceId, petId });

    // 1. Kiểm tra pet tồn tại và thuộc về user
    const pet = await Pet.findOne({
      _id: petId,
      owner: req.user._id,
    }).populate("owner", "phone name");

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    // 2. Kiểm tra owner có phone không
    if (!pet.owner || !pet.owner.phone) {
      return res.status(400).json({
        success: false,
        message: "Pet owner must have a phone number",
      });
    }

    // 3. Tạo hoặc cập nhật device
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        deviceId,
        petId,
        owner: req.user._id,
        isActive: true,
        lastSeen: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log("✅ Device registered:", {
      deviceId,
      petName: pet.name,
      ownerPhone: pet.owner.phone,
      ownerName: pet.owner.name,
    });

    res.json({
      success: true,
      message: "Device registered successfully",
      device: {
        deviceId: device.deviceId,
        petId: device.petId,
        petName: pet.name,
        ownerPhone: pet.owner.phone,
        ownerName: pet.owner.name,
        safeZones: pet.safeZones || [],
      },
    });
  } catch (error) {
    console.error("❌ Device registration error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during device registration",
      error: error.message,
    });
  }
});

// ==============================
// 📍 Lấy petId từ deviceId (cho ESP32) - ĐÃ FIX NULL
// ==============================
router.get("/pet/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔍 Looking up pet for device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      isActive: true,
    }).populate({
      path: "petId",
      select: "name species breed safeZones owner",
      populate: {
        path: "owner",
        select: "phone name email",
      },
    });

    if (!device) {
      console.log("❌ Device not found or not activated:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
      });
    }

    // ⭐ FIX: Kiểm tra null petId
    if (!device.petId) {
      console.log("⚠️ Device has no pet assigned:", deviceId);
      return res.status(400).json({
        success: false,
        message: "Device is not assigned to any pet",
      });
    }

    // ⭐ FIX: Kiểm tra null owner
    const ownerPhone = device.petId.owner?.phone || "0912345678";
    const ownerName = device.petId.owner?.name || "Pet Owner";

    console.log("✅ Found device with pet:", {
      deviceId,
      petName: device.petId.name,
      ownerPhone,
      ownerName,
    });

    res.json({
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      safeZones: device.petId.safeZones || [],
      ownerPhone: ownerPhone,
      ownerName: ownerName,
      warning: !device.petId.owner?.phone
        ? "Using default phone number"
        : undefined,
    });
  } catch (error) {
    console.error("❌ Device lookup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 ENDPOINT MỚI: ESP32 lấy thông tin cấu hình - ĐÃ FIX NULL
// ==============================
router.get("/config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔧 ESP32 requesting config for device:", deviceId);

    // 1. Tìm device với đầy đủ thông tin
    const device = await Device.findOne({
      deviceId,
      isActive: true,
    })
      .populate({
        path: "petId",
        select: "name species breed safeZones owner",
        populate: {
          path: "owner",
          select: "phone name email",
        },
      })
      .lean(); // Convert to plain object để tránh Mongoose document issues

    if (!device) {
      console.log("❌ Device not found in database:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
        deviceId: deviceId,
      });
    }

    console.log("📋 Device document:", JSON.stringify(device, null, 2));

    // 2. ⭐ FIX: Kiểm tra và xử lý null/undefined values
    let petId, petName, ownerPhone, ownerName, safeZones;

    if (!device.petId) {
      console.log("⚠️ Device has no pet assigned, using defaults");
      petId = "unknown_pet_id";
      petName = "Unknown Pet";
      ownerPhone = "0912345678";
      ownerName = "Pet Owner";
      safeZones = [];
    } else {
      petId = device.petId._id?.toString() || device.petId.toString();
      petName = device.petId.name || "Unknown Pet";

      // Kiểm tra owner
      if (!device.petId.owner) {
        console.log("⚠️ Pet has no owner assigned, using defaults");
        ownerPhone = "0912345678";
        ownerName = "Pet Owner";
      } else {
        ownerPhone = device.petId.owner.phone || "0912345678";
        ownerName = device.petId.owner.name || "Pet Owner";
      }

      safeZones = device.petId.safeZones || [];
    }

    console.log("📊 Extracted data for config:", {
      petId,
      petName,
      ownerPhone,
      ownerName,
      safeZonesCount: safeZones.length,
    });

    // 3. Format safe zones
    const formattedSafeZones = safeZones.map((zone, index) => ({
      zone_id: zone._id?.toString() || `safe_zone_${index + 1}`,
      zone_name: zone.name || `Safe Zone ${index + 1}`,
      center_lat: zone.center?.lat || 10.762622,
      center_lng: zone.center?.lng || 106.660172,
      radius_meters: zone.radius || 100,
      is_active: zone.isActive !== false,
      alert_margin: 10,
    }));

    // 4. Tạo response
    const response = {
      success: true,
      deviceId: device.deviceId,
      petId: petId,
      petName: petName,
      phoneNumber: ownerPhone,
      ownerName: ownerName,

      // ⭐ THÔNG TIN VÙNG AN TOÀN
      safe_zones: formattedSafeZones,
      safe_zones_summary: {
        total_zones: formattedSafeZones.length,
        active_zones: formattedSafeZones.filter((z) => z.is_active).length,
        max_radius:
          formattedSafeZones.length > 0
            ? Math.max(...formattedSafeZones.map((z) => z.radius_meters))
            : 100,
        min_radius:
          formattedSafeZones.length > 0
            ? Math.min(...formattedSafeZones.map((z) => z.radius_meters))
            : 100,
      },

      // Thông tin server
      serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
      mqttBroker:
        process.env.MQTT_BROKER_URL ||
        "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
      mqttUsername: process.env.MQTT_USERNAME || "duytan",
      mqttPassword: process.env.MQTT_PASSWORD || "123456",

      // Cấu hình tracking
      updateInterval: 30000, // 30 giây
      gpsAccuracyThreshold: 50, // Ngưỡng độ chính xác GPS (mét)
      movementThreshold: 0.5, // Ngưỡng phát hiện chuyển động (m/s)
      batterySaveMode: true,

      // Thông tin timestamp
      configVersion: "2.1",
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    // 5. Thêm warnings nếu có
    const warnings = [];
    if (!device.petId) warnings.push("Device not assigned to any pet");
    if (!device.petId?.owner) warnings.push("Pet has no owner assigned");
    if (ownerPhone === "0912345678")
      warnings.push("Using default phone number");

    if (warnings.length > 0) {
      response.warnings = warnings;
      console.log("⚠️ Config warnings:", warnings);
    }

    console.log("✅ Config sent to device:", deviceId);
    res.json(response);
  } catch (error) {
    console.error("❌ Get config error details:", {
      message: error.message,
      stack: error.stack,
      deviceId: req.params.deviceId,
    });

    // ⭐ FALLBACK: Luôn trả về config hợp lệ ngay cả khi có lỗi
    res.status(200).json({
      success: true,
      deviceId: req.params.deviceId,
      petId: "fallback_pet_id",
      petName: "Your Pet",
      phoneNumber: "0912345678",
      ownerName: "Pet Owner",
      safe_zones: [
        {
          zone_id: "fallback_zone_1",
          zone_name: "Default Safe Zone",
          center_lat: 10.762622,
          center_lng: 106.660172,
          radius_meters: 100,
          is_active: true,
        },
      ],
      serverUrl: "https://pettracking2.onrender.com",
      mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
      mqttUsername: "duytan",
      mqttPassword: "123456",
      updateInterval: 30000,
      timestamp: new Date().toISOString(),
      configVersion: "fallback_1.0",
      note: "This is a fallback configuration due to server error",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 API FIX: Sửa device bị lỗi trong database
// ==============================
router.post("/fix/:deviceId", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { petId } = req.body;

    console.log("🔧 Fixing device:", deviceId);

    // 1. Kiểm tra pet tồn tại và thuộc về user
    const pet = await Pet.findOne({
      _id: petId,
      owner: req.user._id,
    }).populate("owner", "phone name");

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    // 2. Update device với đầy đủ thông tin
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        petId: pet._id,
        owner: req.user._id,
        isActive: true,
        lastSeen: new Date(),
        fixedAt: new Date(),
      },
      { new: true, upsert: false }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    console.log("✅ Device fixed:", {
      deviceId,
      petName: pet.name,
      ownerPhone: pet.owner.phone,
      ownerName: pet.owner.name,
    });

    res.json({
      success: true,
      message: "Device fixed successfully",
      device: {
        deviceId: device.deviceId,
        petId: device.petId,
        petName: pet.name,
        ownerPhone: pet.owner.phone,
        ownerName: pet.owner.name,
      },
    });
  } catch (error) {
    console.error("❌ Fix device error:", error);
    res.status(500).json({
      success: false,
      message: "Error fixing device",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 API: Kiểm tra trạng thái device
// ==============================
router.get("/status/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId })
      .populate({
        path: "petId",
        select: "name owner",
        populate: {
          path: "owner",
          select: "phone name",
        },
      })
      .lean();

    if (!device) {
      return res.json({
        exists: false,
        message: "Device not found in database",
      });
    }

    const status = {
      exists: true,
      deviceId: device.deviceId,
      isActive: device.isActive || false,
      lastSeen: device.lastSeen,
      hasPet: !!device.petId,
      hasOwner: !!device.petId?.owner,
      hasPhone: !!device.petId?.owner?.phone,
      databaseStatus: "OK",
      issues: [],
    };

    // Kiểm tra issues
    if (!device.petId) {
      status.issues.push("DEVICE_HAS_NO_PET");
    }
    if (!device.petId?.owner) {
      status.issues.push("PET_HAS_NO_OWNER");
    }
    if (!device.petId?.owner?.phone) {
      status.issues.push("OWNER_HAS_NO_PHONE");
    }

    res.json(status);
  } catch (error) {
    console.error("❌ Get device status error:", error);
    res.status(500).json({
      exists: false,
      message: "Error checking device status",
      error: error.message,
    });
  }
});

// ==============================
// 📋 Lấy danh sách devices của user
// ==============================
router.get("/my-devices", auth, async (req, res) => {
  try {
    const devices = await Device.find({ owner: req.user._id })
      .populate({
        path: "petId",
        select: "name species breed safeZones",
        populate: {
          path: "owner",
          select: "phone name",
        },
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: devices.length,
      devices,
    });
  } catch (error) {
    console.error("❌ Get devices error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ==============================
// 🆕 Cập nhật safe zones cho pet
// ==============================
router.put("/:deviceId/safezones", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { safeZones } = req.body;

    console.log("🔄 Updating safe zones for device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      owner: req.user._id,
    }).populate("petId");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or access denied",
      });
    }

    // Cập nhật safe zones cho pet
    device.petId.safeZones = safeZones.map((zone, index) => ({
      name: zone.name || `Safe Zone ${index + 1}`,
      center: {
        lat: parseFloat(zone.center.lat),
        lng: parseFloat(zone.center.lng),
      },
      radius: parseInt(zone.radius) || 100,
      isActive: zone.isActive !== false,
      createdAt: zone.createdAt || new Date(),
      updatedAt: new Date(),
    }));

    await device.petId.save();

    console.log("✅ Safe zones updated for pet:", device.petId.name);

    res.json({
      success: true,
      message: "Safe zones updated",
      safeZones: device.petId.safeZones,
      summary: {
        totalZones: device.petId.safeZones.length,
        activeZones: device.petId.safeZones.filter((z) => z.isActive).length,
      },
    });
  } catch (error) {
    console.error("❌ Update safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating safe zones",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 API để frontend lấy thông tin safe zones của device
// ==============================
router.get("/:deviceId/safezones", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({
      deviceId,
      owner: req.user._id,
    }).populate("petId", "name safeZones");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or access denied",
      });
    }

    res.json({
      success: true,
      deviceId: device.deviceId,
      petName: device.petId.name,
      safeZones: device.petId.safeZones || [],
      lastUpdated: device.petId.updatedAt,
    });
  } catch (error) {
    console.error("❌ Get safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching safe zones",
    });
  }
});

module.exports = router;
