const express = require("express");
const Device = require("../models/device");
const Pet = require("../models/pet"); // 🚨 ĐÃ THÊM
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

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

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

    const deviceExists = await Device.exists({ deviceId: deviceId });

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
// 🆕 HELPER: Build config response - ĐÃ FIX (GIỚI HẠN 5 ZONES)
// ==============================
function buildConfigResponse(res, device) {
  try {
    if (!device.petId) {
      throw new Error("Pet not found for device");
    }

    if (!device.owner || !device.owner.phone) {
      throw new Error("Owner phone number is required");
    }

    // 🚨 FIXED: GIỚI HẠN CHỈ 5 SAFE ZONES MỚI NHẤT
    let safeZonesInfo = [];
    const MAX_ZONES_FOR_ESP32 = 5; // 🚨 GIỚI HẠN QUAN TRỌNG

    if (device.petId.safeZones && device.petId.safeZones.length > 0) {
      // Lấy TẤT CẢ safe zones đang active
      const activeZones = device.petId.safeZones.filter(
        (zone) => zone.isActive
      );

      // 🚨 SORT BY CREATION DATE (NEWEST FIRST)
      const sortedZones = activeZones.sort((a, b) => {
        const dateA = a.createdAt || a._id.getTimestamp();
        const dateB = b.createdAt || b._id.getTimestamp();
        return new Date(dateB) - new Date(dateA);
      });

      // 🚨 GIỚI HẠN CHỈ 5 ZONES MỚI NHẤT
      const limitedZones = sortedZones.slice(0, MAX_ZONES_FOR_ESP32);

      if (limitedZones.length > 0) {
        safeZonesInfo = limitedZones.map((zone) => ({
          center: {
            lat: zone.center.lat,
            lng: zone.center.lng,
          },
          radius: zone.radius || 100,
          name: zone.name || "Safe Zone",
          isActive: true,
          _id: zone._id.toString(),
          priority: 1, // Thêm priority cho ESP32
        }));
      }
    }

    const totalZonesInDB = device.petId.safeZones?.length || 0;
    const activeZonesCount =
      device.petId.safeZones?.filter((z) => z.isActive).length || 0;

    console.log("✅ Sending config to ESP32:", {
      deviceId: device.deviceId,
      petName: device.petId.name,
      ownerPhone: device.owner.phone,
      safeZonesSent: safeZonesInfo.length,
      activeZonesInDB: activeZonesCount,
      totalZonesInDB: totalZonesInDB,
    });

    // Build response
    const response = {
      success: true,

      deviceId: device.deviceId,
      petId: device.petId._id.toString(),
      petName: device.petId.name,
      phoneNumber: device.owner.phone,
      ownerName: device.owner.name,

      timestamp: new Date().toISOString(),
    };

    if (safeZonesInfo.length > 0) {
      response.safeZones = safeZonesInfo;
    }

    // Thêm warning nếu có quá nhiều zones
    if (totalZonesInDB > MAX_ZONES_FOR_ESP32) {
      response.warning = `Only showing ${MAX_ZONES_FOR_ESP32} most recent active zones out of ${totalZonesInDB} total zones`;
      response.debug = {
        deviceRegistered: new Date(device.createdAt).toISOString(),
        lastSeen: device.lastSeen
          ? new Date(device.lastSeen).toISOString()
          : null,
        configSent: device.configSent || false,
        petSpecies: device.petId.species,
        configVia: "HTTP API",
        safeZonesSent: safeZonesInfo.length,
        safeZonesActiveInDB: activeZonesCount,
        safeZonesTotalInDB: totalZonesInDB,
        zonesLimit: MAX_ZONES_FOR_ESP32,
      };
    } else {
      response.debug = {
        deviceRegistered: new Date(device.createdAt).toISOString(),
        lastSeen: device.lastSeen
          ? new Date(device.lastSeen).toISOString()
          : null,
        configSent: device.configSent || false,
        petSpecies: device.petId.species,
        configVia: "HTTP API",
        safeZonesReceived: safeZonesInfo.length,
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

    await mqttService.manualPublishConfig(deviceId);

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

    await mqttService.manualPublishConfig(deviceId);

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
// 🆕 ENDPOINT: CLEAN UP EXCESS SAFE ZONES 🧹
// ==============================
router.post("/cleanup-safe-zones/:petId", auth, async (req, res) => {
  try {
    const { petId } = req.params;
    const { keepCount = 5 } = req.body;

    console.log(
      `🧹 Cleaning up safe zones for pet ${petId}, keeping ${keepCount} most recent`
    );

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    const totalZones = pet.safeZones.length;

    if (totalZones <= keepCount) {
      return res.json({
        success: true,
        message: `Only ${totalZones} safe zones, no cleanup needed`,
        totalZones,
        keptZones: totalZones,
        petName: pet.name,
      });
    }

    // Sort zones by creation date (newest first)
    pet.safeZones.sort((a, b) => {
      const dateA = a.createdAt || a._id.getTimestamp();
      const dateB = b.createdAt || b._id.getTimestamp();
      return new Date(dateB) - new Date(dateA);
    });

    const zonesToKeep = pet.safeZones.slice(0, keepCount);
    const zonesToDelete = pet.safeZones.slice(keepCount);

    // Update pet with only kept zones
    pet.safeZones = zonesToKeep;
    await pet.save();

    console.log(
      `✅ Cleaned up ${zonesToDelete.length} old safe zones from pet ${pet.name}`
    );

    // Trigger config update for associated devices
    try {
      const devices = await Device.find({ petId: petId, isActive: true });
      devices.forEach((device) => {
        setTimeout(() => {
          mqttService.manualPublishConfig(device.deviceId);
          console.log(
            `⚙️ Auto-sent config to ${device.deviceId} after cleanup`
          );
        }, 1000);
      });
    } catch (mqttError) {
      console.error("MQTT auto-config error after cleanup:", mqttError);
    }

    res.json({
      success: true,
      message: `Cleaned up ${zonesToDelete.length} old safe zones`,
      petName: pet.name,
      kept: zonesToKeep.length,
      deleted: zonesToDelete.length,
      totalBefore: totalZones,
      totalAfter: zonesToKeep.length,
      zonesKept: zonesToKeep.map((z) => ({
        id: z._id,
        name: z.name,
        radius: z.radius,
        createdAt: z.createdAt || z._id.getTimestamp(),
      })),
    });
  } catch (error) {
    console.error("❌ Cleanup safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during cleanup",
      error: error.message,
    });
  }
});

// ==============================
// 🆕 ENDPOINT: Get safe zones count info
// ==============================
router.get("/safe-zones-info/:petId", auth, async (req, res) => {
  try {
    const { petId } = req.params;

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id }).select(
      "name safeZones"
    );

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    const totalZones = pet.safeZones.length;
    const activeZones = pet.safeZones.filter((z) => z.isActive).length;
    const inactiveZones = totalZones - activeZones;

    // Get unique locations count
    const uniqueLocations = new Set();
    pet.safeZones.forEach((zone) => {
      if (zone.center) {
        const key = `${zone.center.lat.toFixed(6)},${zone.center.lng.toFixed(
          6
        )}`;
        uniqueLocations.add(key);
      }
    });

    res.json({
      success: true,
      petName: pet.name,
      petId: pet._id,
      zonesInfo: {
        total: totalZones,
        active: activeZones,
        inactive: inactiveZones,
        uniqueLocations: uniqueLocations.size,
        recommendation:
          totalZones > 10
            ? `⚠️ Có quá nhiều safe zones (${totalZones}). Nên dọn dẹp.`
            : "✅ Số lượng safe zones hợp lý.",
      },
      zonesSample: pet.safeZones
        .sort(
          (a, b) =>
            new Date(b.createdAt || b._id.getTimestamp()) -
            new Date(a.createdAt || a._id.getTimestamp())
        )
        .slice(0, 5)
        .map((z) => ({
          id: z._id,
          name: z.name,
          radius: z.radius,
          isActive: z.isActive,
          location: z.center
            ? `${z.center.lat.toFixed(6)}, ${z.center.lng.toFixed(6)}`
            : null,
          createdAt: z.createdAt || z._id.getTimestamp(),
        })),
    });
  } catch (error) {
    console.error("❌ Get safe zones info error:", error);
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
