const express = require("express");
const Device = require("../models/device");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// ==============================
// 🔧 Đăng ký device với pet
// ==============================
router.post("/register", auth, async (req, res) => {
  try {
    const { deviceId, petId } = req.body;

    console.log("📱 Device registration:", { deviceId, petId });

    // Kiểm tra pet thuộc về user
    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    // Tạo hoặc cập nhật device
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        deviceId,
        petId,
        owner: req.user._id,
        isActive: true,
        lastSeen: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log("✅ Device registered:", deviceId, "for pet:", pet.name);

    res.json({
      success: true,
      message: "Device registered successfully",
      device: {
        deviceId: device.deviceId,
        petId: device.petId,
        petName: pet.name,
        safeZones: pet.safeZones || [],
      },
    });
  } catch (error) {
    console.error("❌ Device registration error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during device registration",
    });
  }
});

// ==============================
// 📍 Lấy petId từ deviceId (cho ESP32)
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
      select: "name species breed safeZones",
      populate: {
        path: "owner",
        select: "phone",
      },
    });

    if (!device) {
      console.log("❌ Device not found or not activated:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
      });
    }

    console.log("✅ Found pet for device:", device.petId.name);

    // Trả về thông tin vùng an toàn với bán kính đầy đủ
    const formattedSafeZones = device.petId.safeZones.map((zone) => ({
      id: zone._id || `zone_${Date.now()}`,
      name: zone.name || "Safe Zone",
      center: {
        lat: zone.center.lat,
        lng: zone.center.lng,
      },
      radius: zone.radius, // ⭐ BÁN KÍNH BẠN ĐÃ SET TRÊN FRONTEND
      radius_meters: zone.radius, // Để rõ ràng
      radius_km: (zone.radius / 1000).toFixed(2), // Chuyển sang km
      isActive: zone.isActive !== false,
      createdAt: zone.createdAt || new Date().toISOString(),
    }));

    res.json({
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      safeZones: formattedSafeZones,
      ownerPhone: device.petId.owner?.phone || null,
    });
  } catch (error) {
    console.error("❌ Device lookup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
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
          select: "phone",
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
// 🆕 ENDPOINT MỚI: ESP32 lấy thông tin cấu hình (petId, phoneNumber, safe zones với bán kính)
// ==============================
router.get("/config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔧 ESP32 requesting config for device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      isActive: true,
    }).populate({
      path: "petId",
      select: "name species breed safeZones",
      populate: {
        path: "owner",
        select: "phone name",
      },
    });

    if (!device) {
      console.log("❌ Device not found:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
      });
    }

    // ✅ KIỂM TRA: device có owner và owner có phone không
    if (!device.petId.owner || !device.petId.owner.phone) {
      console.log("❌ Owner or phone not found for device:", deviceId);
      return res.status(400).json({
        success: false,
        message: "Owner information incomplete",
      });
    }

    const safeZones = device.petId.safeZones || [];

    // ⭐ FORMAT SAFE ZONES VỚI ĐẦY ĐỦ THÔNG TIN BÁN KÍNH
    const formattedSafeZones = safeZones.map((zone, index) => ({
      zone_id: zone._id || `safe_zone_${index + 1}`,
      zone_name: zone.name || `Vùng an toàn ${index + 1}`,
      center_lat: zone.center.lat,
      center_lng: zone.center.lng,
      radius_meters: zone.radius, // ⭐ BÁN KÍNH BẠN ĐÃ SET (tính bằng mét)
      radius_feet: Math.round(zone.radius * 3.28084), // Chuyển sang feet
      is_active: zone.isActive !== false,
      alert_threshold: Math.round(zone.radius * 1.1), // Ngưỡng cảnh báo = 110% bán kính
      created_at: zone.createdAt || new Date().toISOString(),
    }));

    console.log("✅ Sending config to ESP32:", {
      deviceId,
      petName: device.petId.name,
      ownerPhone: device.petId.owner.phone,
      safeZonesCount: safeZones.length,
      safeZoneRadii: formattedSafeZones.map((z) => `${z.radius_meters}m`),
    });

    // ✅ RESPONSE với số điện thoại và safe zones ĐẦY ĐỦ BÁN KÍNH
    res.json({
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      phoneNumber: device.petId.owner.phone, // SỐ ĐIỆN THOẠI
      ownerName: device.petId.owner.name,

      // ⭐ THÔNG TIN VÙNG AN TOÀN CHI TIẾT
      safe_zones: formattedSafeZones,
      safe_zones_summary: {
        total_zones: formattedSafeZones.length,
        active_zones: formattedSafeZones.filter((z) => z.is_active).length,
        max_radius: Math.max(...formattedSafeZones.map((z) => z.radius_meters)),
        min_radius: Math.min(...formattedSafeZones.map((z) => z.radius_meters)),
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

      // Thông tin timestamp
      configVersion: "1.2",
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Hết hạn sau 7 ngày
    });
  } catch (error) {
    console.error("❌ Get config error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching device config",
    });
  }
});

// ==============================
// 🆕 Cập nhật safe zones cho pet (bao gồm bán kính)
// ==============================
router.put("/:deviceId/safezones", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { safeZones } = req.body;

    console.log("🔄 Updating safe zones for device:", deviceId);
    console.log("📋 Safe zones data:", JSON.stringify(safeZones, null, 2));

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

    // ⭐ VALIDATE SAFE ZONES DATA
    const validatedSafeZones = safeZones.map((zone, index) => ({
      name: zone.name || `Safe Zone ${index + 1}`,
      center: {
        lat: parseFloat(zone.center.lat),
        lng: parseFloat(zone.center.lng),
      },
      radius: parseInt(zone.radius) || 100, // ⭐ BÁN KÍNH từ frontend
      isActive: zone.isActive !== false,
      createdAt: zone.createdAt || new Date(),
      updatedAt: new Date(),
    }));

    // Cập nhật safe zones cho pet
    device.petId.safeZones = validatedSafeZones;
    await device.petId.save();

    console.log("✅ Safe zones updated for pet:", device.petId.name);
    console.log(
      "📏 Zone radii:",
      validatedSafeZones.map((z) => `${z.radius}m`)
    );

    // Gửi config mới qua MQTT
    const mqttService = require("../mqttSubscriber");
    mqttService.sendDeviceConfig(
      deviceId,
      device.petId,
      req.user.phone,
      validatedSafeZones
    );

    res.json({
      success: true,
      message: "Safe zones updated and pushed to device",
      safeZones: validatedSafeZones,
      summary: {
        totalZones: validatedSafeZones.length,
        activeZones: validatedSafeZones.filter((z) => z.isActive).length,
        radiusRange: {
          min: Math.min(...validatedSafeZones.map((z) => z.radius)),
          max: Math.max(...validatedSafeZones.map((z) => z.radius)),
          average: Math.round(
            validatedSafeZones.reduce((sum, z) => sum + z.radius, 0) /
              validatedSafeZones.length
          ),
        },
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
