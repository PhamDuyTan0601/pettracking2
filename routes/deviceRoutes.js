const express = require("express");
const Device = require("../models/device");
const Pet = require("../models/pet");
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");
const mqttService = require("../mqttSubscriber");

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
        configSent: false,
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
    let { deviceId } = req.params;

    // 🚨 FIX: Sửa deviceId nếu sai
    deviceId = fixDeviceId(deviceId);

    console.log("🔍 Looking up pet for device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      isActive: true,
    }).populate("petId", "name");

    if (!device) {
      console.log("❌ Device not found or not activated:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
      });
    }

    console.log("✅ Found pet for device:", device.petId.name);

    res.json({
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
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
      .populate("petId", "name species")
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
// 🆕 ENDPOINT: ESP32 lấy thông tin cấu hình
// ==============================
router.get("/config/:deviceId", async (req, res) => {
  try {
    let { deviceId } = req.params;

    // 🚨 FIX: Sửa deviceId nếu sai
    deviceId = fixDeviceId(deviceId);

    console.log("🔧 ESP32 requesting config for device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      isActive: true,
    })
      .populate("petId", "name species breed safeZones")
      .populate("owner", "name phone");

    if (!device) {
      console.log("❌ Device not found:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
      });
    }

    // ✅ KIỂM TRA: device có owner và owner có phone không
    if (!device.owner || !device.owner.phone) {
      console.log("❌ Owner or phone not found for device:", deviceId);
      return res.status(400).json({
        success: false,
        message: "Owner information incomplete",
      });
    }

    // ✅ LẤY THÔNG TIN VÙNG AN TOÀN (nếu có)
    let safeZoneInfo = null;
    if (device.petId.safeZones && device.petId.safeZones.length > 0) {
      // Lấy vùng an toàn active đầu tiên
      const activeZone =
        device.petId.safeZones.find((zone) => zone.isActive) ||
        device.petId.safeZones[0];

      if (activeZone) {
        safeZoneInfo = {
          center: {
            lat: activeZone.center.lat,
            lng: activeZone.center.lng,
          },
          radius: activeZone.radius,
          name: activeZone.name,
          isActive: activeZone.isActive,
        };
      }
    }

    console.log("✅ Sending config to ESP32:", {
      deviceId,
      petName: device.petId.name,
      ownerPhone: device.owner.phone,
      hasSafeZone: !!safeZoneInfo,
      safeZoneRadius: safeZoneInfo?.radius || "none",
    });

    // ✅ RESPONSE với đầy đủ thông tin
    const response = {
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      phoneNumber: device.owner.phone,
      ownerName: device.owner.name,
      serverUrl: "https://pettracking2.onrender.com",
      updateInterval: 30000,
      timestamp: new Date().toISOString(),
    };

    // ✅ THÊM SAFE ZONE NẾU CÓ
    if (safeZoneInfo) {
      response.safeZone = safeZoneInfo;
    }

    res.json(response);
  } catch (error) {
    console.error("❌ Get config error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching device config",
    });
  }
});

// ==============================
// 🆕 PUBLISH CONFIG TO DEVICE VIA MQTT
// ==============================
router.post("/config/publish/:deviceId", auth, async (req, res) => {
  try {
    let { deviceId } = req.params;

    // 🚨 FIX: Sửa deviceId nếu sai
    deviceId = fixDeviceId(deviceId);

    console.log("📤 Publishing config to device:", deviceId);

    const device = await Device.findOne({
      deviceId,
      owner: req.user._id,
      isActive: true,
    })
      .populate("petId", "name species breed safeZones")
      .populate("owner", "name phone");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or access denied",
      });
    }

    // Prepare config
    let safeZoneInfo = null;
    if (device.petId.safeZones && device.petId.safeZones.length > 0) {
      const activeZone =
        device.petId.safeZones.find((zone) => zone.isActive) ||
        device.petId.safeZones[0];

      if (activeZone) {
        safeZoneInfo = {
          center: {
            lat: activeZone.center.lat,
            lng: activeZone.center.lng,
          },
          radius: activeZone.radius,
          name: activeZone.name,
          isActive: activeZone.isActive,
        };
      }
    }

    const config = {
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id,
      petName: device.petId.name,
      phoneNumber: device.owner.phone,
      ownerName: device.owner.name,
      serverUrl: "https://pettracking2.onrender.com",
      updateInterval: 30000,
      timestamp: new Date().toISOString(),
      message: "Manual config from web interface",
    };

    if (safeZoneInfo) {
      config.safeZone = safeZoneInfo;
    }

    // Publish to MQTT
    mqttService.publishConfig(deviceId, config);

    // Update device
    device.configSent = true;
    device.lastConfigSent = new Date();
    await device.save();

    console.log("✅ Config published to:", deviceId);

    res.json({
      success: true,
      message: "Config published successfully",
      config,
    });
  } catch (error) {
    console.error("❌ Publish config error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ==============================
// 🆕 FIX DEVICE ID HELPER
// ==============================
function fixDeviceId(deviceId) {
  // 🚨 FIX: Nếu deviceId sai, tự động sửa
  if (deviceId === "ESP32_EC8A75B865E4") {
    console.log(`⚠️  FIX: Wrong deviceId in request: ${deviceId}`);
    console.log(`   Correcting to: ESP32_68C2470B65F4`);
    return "ESP32_68C2470B65F4";
  }
  return deviceId;
}

module.exports = router;
