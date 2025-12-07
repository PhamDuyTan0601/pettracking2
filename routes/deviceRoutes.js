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

    // Auto send config sau khi đăng ký
    setTimeout(async () => {
      await mqttService.manualPublishConfig(deviceId);
    }, 1000);

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

    // Lấy thông tin device
    let deviceInfo = null;
    if (deviceExists) {
      deviceInfo = await Device.findOne({ deviceId: deviceId })
        .populate("petId", "name")
        .populate("owner", "phone");
    }

    res.json({
      success: true,
      deviceId: deviceId,
      deviceExists: !!deviceExists,
      deviceInfo: deviceInfo
        ? {
            petName: deviceInfo.petId?.name,
            ownerPhone: deviceInfo.owner?.phone,
            isActive: deviceInfo.isActive,
            configSent: deviceInfo.configSent,
            lastSeen: deviceInfo.lastSeen,
          }
        : null,
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

    // Tìm device trong DB
    const device = await Device.findOne({
      deviceId: deviceId,
      isActive: true,
    })
      .populate("petId", "name species breed safeZones")
      .populate("owner", "name phone");

    if (!device) {
      console.log("❌ Device not found or not active:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not registered or not active",
        deviceId: deviceId,
        hint: "Please register device first via /api/devices/register",
      });
    }

    // Build response
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

    // Lấy thông tin vùng an toàn
    let safeZoneInfo = null;
    if (device.petId.safeZones && device.petId.safeZones.length > 0) {
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

    // Build response
    const response = {
      success: true,
      _source: "http_api",
      deviceId: device.deviceId,
      petId: device.petId._id.toString(),
      petName: device.petId.name,
      phoneNumber: device.owner.phone,
      ownerName: device.owner.name,
      serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
      updateInterval: 30000,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      mqttConfig: {
        broker: "u799c202.ala.dedicated.aws.emqxcloud.com",
        port: 1883,
        username: "duytan",
        password: "123456",
        topics: {
          location: `pets/${device.deviceId}/location`,
          status: `pets/${device.deviceId}/status`,
          alert: `pets/${device.deviceId}/alert`,
          config: `pets/${device.deviceId}/config`,
        },
      },
    };

    // Thêm safe zone nếu có
    if (safeZoneInfo) {
      response.safeZone = safeZoneInfo;
    }

    // Thêm thông tin debug
    response.debug = {
      deviceRegistered: new Date(device.createdAt).toISOString(),
      lastSeen: device.lastSeen
        ? new Date(device.lastSeen).toISOString()
        : null,
      configSent: device.configSent || false,
      petSpecies: device.petId.species,
      configVia: "HTTP API",
    };

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

    console.log("📤 Publishing config to device via MQTT:", deviceId);

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

    // Gọi MQTT service để publish config
    await mqttService.manualPublishConfig(deviceId);

    // Update device
    device.configSent = true;
    device.lastConfigSent = new Date();
    await device.save();

    console.log("✅ Config published to:", deviceId);

    res.json({
      success: true,
      message: "Config published successfully via MQTT",
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
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
// 🆕 ENDPOINT: TRIGGER CONFIG SEND NGAY LẬP TỨC (No auth - for ESP32)
// ==============================
router.post("/trigger-config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🚀 Manual trigger config for device:", deviceId);

    // Kiểm tra device
    const device = await Device.findOne({
      deviceId,
      isActive: true,
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or not active",
      });
    }

    // Gọi MQTT service để gửi config
    await mqttService.manualPublishConfig(deviceId);

    // Cập nhật trạng thái
    device.configSent = true;
    device.lastConfigSent = new Date();
    await device.save();

    console.log("✅ Config triggered for:", deviceId);

    res.json({
      success: true,
      message: "Config sent to device via MQTT",
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Trigger config error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ==============================
// 🆕 ENDPOINT: CLEAR RETAINED MESSAGES
// ==============================
router.post("/clear-retained/:deviceId", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🧹 Clearing retained messages for:", deviceId);

    // Kiểm tra device thuộc về user
    const device = await Device.findOne({
      deviceId,
      owner: req.user._id,
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found or access denied",
      });
    }

    // Gọi MQTT service để clear retained messages
    await mqttService.clearRetainedMessages(deviceId);

    res.json({
      success: true,
      message: "Retained messages cleared",
      deviceId: deviceId,
    });
  } catch (error) {
    console.error("❌ Clear retained error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ==============================
// 🆕 ENDPOINT: Get device status
// ==============================
router.get("/status/:deviceId", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({
      deviceId,
      owner: req.user._id,
    })
      .populate("petId", "name")
      .populate("owner", "name phone");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    res.json({
      success: true,
      device: {
        deviceId: device.deviceId,
        isActive: device.isActive,
        configSent: device.configSent,
        lastConfigSent: device.lastConfigSent,
        lastSeen: device.lastSeen,
        createdAt: device.createdAt,
        pet: device.petId
          ? {
              name: device.petId.name,
              id: device.petId._id,
            }
          : null,
        mqttConnected: mqttService.getConnectionStatus(),
      },
    });
  } catch (error) {
    console.error("❌ Get device status error:", error);
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
      .select("deviceId petId owner configSent lastSeen createdAt isActive")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: devices.length,
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        petName: d.petId?.name || "No pet",
        ownerName: d.owner?.name || "No owner",
        ownerPhone: d.owner?.phone || "No phone",
        configSent: d.configSent,
        lastSeen: d.lastSeen,
        createdAt: d.createdAt,
        isActive: d.isActive,
        mqttConnected: mqttService.getConnectionStatus(),
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
