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

    // Format safe zones cho frontend
    const formattedSafeZones = (device.petId.safeZones || []).map((zone) => ({
      id: zone._id || `zone_${Date.now()}`,
      name: zone.name || "Safe Zone",
      center: {
        lat: zone.center.lat,
        lng: zone.center.lng,
      },
      radius: zone.radius || 100, // Bán kính mặc định 100m
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
// 🆕 ENDPOINT MỚI: ESP32 lấy thông tin cấu hình
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

    if (!device.petId.owner || !device.petId.owner.phone) {
      console.log("❌ Owner or phone not found for device:", deviceId);
      return res.status(400).json({
        success: false,
        message: "Owner information incomplete",
      });
    }

    const safeZones = device.petId.safeZones || [];

    // ⭐ FORMAT SAFE ZONES CHO ESP32
    const formattedSafeZones = safeZones.map((zone, index) => ({
      zone_id: zone._id || `safe_zone_${index + 1}`,
      zone_name: zone.name || `Vùng an toàn ${index + 1}`,
      center_lat: zone.center.lat,
      center_lng: zone.center.lng,
      radius_meters: zone.radius || 100, // ⭐ BÁN KÍNH
      is_active: zone.isActive !== false,
      alert_margin: 10, // Biên độ cảnh báo thêm 10m
    }));

    console.log("✅ Sending config to ESP32:", {
      deviceId,
      petName: device.petId.name,
      ownerPhone: device.petId.owner.phone,
      safeZonesCount: safeZones.length,
    });

    // ⭐ RESPONSE CHO ESP32
    res.json({
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      phoneNumber: device.petId.owner.phone,
      ownerName: device.petId.owner.name,

      // ⭐ THÔNG TIN VÙNG AN TOÀN ĐẦY ĐỦ
      safe_zones: formattedSafeZones,

      // Thông tin server
      serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
      mqttBroker:
        process.env.MQTT_BROKER_URL ||
        "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
      mqttUsername: process.env.MQTT_USERNAME || "duytan",
      mqttPassword: process.env.MQTT_PASSWORD || "123456",

      // Cấu hình tracking
      updateInterval: 30000,
      gpsAccuracyThreshold: 50,
      movementThreshold: 0.5,

      timestamp: new Date().toISOString(),
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
// 🆕 API để frontend quản lý multiple safe zones
// ==============================
router.put("/:deviceId/safezones", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { safeZones } = req.body;

    console.log("🔄 Updating safe zones for device:", deviceId);
    console.log("📋 Received safe zones:", safeZones);

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

    // ⭐ VALIDATE VÀ FORMAT SAFE ZONES
    const validatedSafeZones = safeZones.map((zone, index) => ({
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

    // Lưu vào database
    device.petId.safeZones = validatedSafeZones;
    await device.petId.save();

    console.log("✅ Safe zones updated for pet:", device.petId.name);

    // ⭐ GỬI CẤU HÌNH MỚI QUA MQTT CHO ESP32
    const mqttService = require("../mqttSubscriber");

    // Tạo config mới
    const config = {
      petId: device.petId._id,
      petName: device.petId.name,
      phoneNumber: req.user.phone,
      safe_zones: validatedSafeZones.map((zone, idx) => ({
        zone_id: `zone_${idx + 1}`,
        zone_name: zone.name,
        center_lat: zone.center.lat,
        center_lng: zone.center.lng,
        radius_meters: zone.radius,
        is_active: zone.isActive,
      })),
      timestamp: new Date().toISOString(),
    };

    // Publish qua MQTT
    mqttService.client.publish(
      `pets/${deviceId}/config`,
      JSON.stringify(config),
      { qos: 1, retain: true }
    );

    console.log(`⚙️ Config pushed to ESP32 via MQTT`);

    res.json({
      success: true,
      message: "Safe zones updated and pushed to device",
      safeZones: validatedSafeZones,
      mqttPushed: true,
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
// 🆕 API để frontend lấy thông tin safe zones
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

// ==============================
// 🆕 API để frontend tạo multiple safe zones từ map
// ==============================
router.post("/:deviceId/safezones/multiple", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { safeZones } = req.body;

    console.log("🎯 Creating multiple safe zones for device:", deviceId);

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

    // Thêm safe zones mới vào danh sách hiện có
    const existingZones = device.petId.safeZones || [];
    const newZones = safeZones.map((zone, index) => ({
      name: zone.name || `Vùng ${existingZones.length + index + 1}`,
      center: {
        lat: parseFloat(zone.center.lat),
        lng: parseFloat(zone.center.lng),
      },
      radius: parseInt(zone.radius) || 100,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    device.petId.safeZones = [...existingZones, ...newZones];
    await device.petId.save();

    console.log(`✅ Added ${newZones.length} safe zones`);

    res.json({
      success: true,
      message: `Đã thêm ${newZones.length} vùng an toàn mới`,
      totalZones: device.petId.safeZones.length,
      newZones: newZones,
    });
  } catch (error) {
    console.error("❌ Create multiple safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating safe zones",
    });
  }
});

module.exports = router;
