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
// 🆕 ENDPOINT: ESP32 test connection
// ==============================
router.get("/test/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔍 ESP32 test connection for device:", deviceId);

    // Kiểm tra device có tồn tại không
    const deviceExists = await Device.exists({ deviceId: deviceId });

    res.json({
      success: true,
      deviceId: deviceId,
      deviceExists: !!deviceExists,
      serverTime: new Date().toISOString(),
      serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
      message: deviceExists
        ? "Device is registered"
        : "Device not found - please register first",
    });
  } catch (error) {
    console.error("❌ Test endpoint error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 ENDPOINT: ESP32 lấy thông tin cấu hình
// ==============================
router.get("/config/:deviceId", async (req, res) => {
  try {
    let { deviceId } = req.params;

    console.log("🔧 ESP32 requesting config for device:", deviceId);

    // Không dùng fix cứng nữa, chỉ log cảnh báo
    if (deviceId === "ESP32_EC8A75B865E4") {
      console.log("⚠️  WARNING: Possible wrong deviceId detected:", deviceId);
      console.log("   Expected format: ESP32_XXXXXXXXXXXX");
    }

    // Tìm device trong DB với deviceId chính xác
    const device = await Device.findOne({
      deviceId: deviceId,
      isActive: true,
    })
      .populate("petId", "name species breed safeZones")
      .populate("owner", "name phone");

    if (!device) {
      console.log("❌ Device not found or not active:", deviceId);

      // Thử tìm với deviceId khác (nếu có sai sót về chữ hoa/thường)
      const alternativeDevice = await Device.findOne({
        deviceId: { $regex: new RegExp(deviceId, "i") },
        isActive: true,
      });

      if (alternativeDevice) {
        console.log(
          "ℹ️  Found device with case-insensitive match:",
          alternativeDevice.deviceId
        );
        // Trả về device tìm thấy
        return buildConfigResponse(res, alternativeDevice);
      }

      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
        deviceId: deviceId,
        hint: "Please register device first via /api/devices/register",
      });
    }

    // ✅ Gọi hàm build response
    return buildConfigResponse(res, device);
  } catch (error) {
    console.error("❌ Get config error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching device config",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 HELPER: Build config response
// ==============================
function buildConfigResponse(res, device) {
  try {
    // Validate required data
    if (!device.petId) {
      throw new Error("Pet not found for device");
    }

    if (!device.owner || !device.owner.phone) {
      throw new Error("Owner phone number is required");
    }

    // ✅ LẤY THÔNG TIN VÙNG AN TOÀN (nếu có)
    let safeZoneInfo = null;
    if (device.petId.safeZones && device.petId.safeZones.length > 0) {
      // Lấy vùng an toàn active đầu tiên
      const activeZone =
        device.petId.safeZones.find((zone) => zone.isActive) ||
        device.petId.safeZones[0];

      if (
        activeZone &&
        activeZone.center &&
        activeZone.center.lat &&
        activeZone.center.lng
      ) {
        safeZoneInfo = {
          center: {
            lat: activeZone.center.lat,
            lng: activeZone.center.lng,
          },
          radius: activeZone.radius || 100,
          name: activeZone.name || "Safe Zone",
          isActive: activeZone.isActive !== false,
        };
      }
    }

    console.log("✅ Sending config to ESP32:", {
      deviceId: device.deviceId,
      petName: device.petId.name,
      ownerPhone: device.owner.phone,
      hasSafeZone: !!safeZoneInfo,
      safeZoneRadius: safeZoneInfo?.radius || "none",
    });

    // ✅ BUILD RESPONSE
    const response = {
      success: true,
      deviceId: device.deviceId,
      petId: device.petId._id.toString(),
      petName: device.petId.name,
      phoneNumber: device.owner.phone,
      ownerName: device.owner.name,
      serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
      apiEndpoints: {
        submitData: "/api/petData",
        getConfig: `/api/devices/config/${device.deviceId}`,
        healthCheck: "/health",
      },
      updateInterval: 30000, // 30 giây
      heartbeatInterval: 60000, // 1 phút
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    };

    // ✅ THÊM SAFE ZONE NẾU CÓ
    if (safeZoneInfo) {
      response.safeZone = safeZoneInfo;
    }

    // ✅ THÊM THÔNG TIN DEBUG (chỉ trong môi trường dev)
    if (process.env.NODE_ENV === "development") {
      response.debug = {
        deviceRegistered: new Date(device.createdAt).toISOString(),
        lastSeen: device.lastSeen
          ? new Date(device.lastSeen).toISOString()
          : null,
        configSent: device.configSent || false,
        petSpecies: device.petId.species,
      };
    }

    res.json(response);
  } catch (error) {
    console.error("❌ Error building config response:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to build configuration",
      deviceId: device.deviceId,
    });
  }
}

// ==============================
// 🆕 PUBLISH CONFIG TO DEVICE VIA MQTT
// ==============================
router.post("/config/publish/:deviceId", auth, async (req, res) => {
  try {
    let { deviceId } = req.params;

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
// 🆕 ENDPOINT: List all devices (debug)
// ==============================
router.get("/list/devices", auth, async (req, res) => {
  try {
    const devices = await Device.find({ isActive: true })
      .populate("petId", "name")
      .populate("owner", "name phone")
      .select("deviceId petId owner configSent lastSeen createdAt");

    res.json({
      success: true,
      count: devices.length,
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        petName: d.petId?.name || "No pet",
        ownerPhone: d.owner?.phone || "No phone",
        configSent: d.configSent,
        lastSeen: d.lastSeen,
        createdAt: d.createdAt,
      })),
    });
  } catch (error) {
    console.error("❌ List devices error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
