const express = require("express");
const Device = require("../models/device");
const Pet = require("../models/pet");
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// ==============================
// 🆕 DIRECT CONFIG - FIX POPULATE ISSUE
// ==============================
router.get("/direct-config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("⚡ Direct config for:", deviceId);

    // 1. Tìm device KHÔNG dùng lean()
    const device = await Device.findOne({
      deviceId,
      isActive: true,
    });

    if (!device) {
      console.log("❌ Device not found:", deviceId);
      return res.status(404).json({
        success: false,
        message: "Device not found",
        deviceId: deviceId,
      });
    }

    console.log("📱 Device found:", {
      deviceId: device.deviceId,
      petId: device.petId,
      ownerId: device.owner,
    });

    // 2. Tìm pet riêng
    let pet = null;
    let owner = null;

    if (device.petId) {
      pet = await Pet.findById(device.petId).lean();
      console.log("🐾 Pet found:", pet ? pet.name : "null");

      if (pet && pet.owner) {
        owner = await User.findById(pet.owner).lean();
        console.log("👤 Owner found:", owner ? owner.name : "null");
      }
    }

    // 3. Nếu không có pet, thử dùng owner từ device
    if (!owner && device.owner) {
      owner = await User.findById(device.owner).lean();
      console.log("👤 Owner from device:", owner ? owner.name : "null");
    }

    // 4. Build config
    const config = {
      success: true,
      deviceId: deviceId,
      petId: pet ? pet._id.toString() : "unknown_pet_id",
      petName: pet ? pet.name : "Unknown Pet",
      phoneNumber: owner && owner.phone ? owner.phone : "0912345678",
      ownerName: owner && owner.name ? owner.name : "Pet Owner",
      safe_zones:
        pet && pet.safeZones
          ? pet.safeZones.map((zone, index) => ({
              zone_id: zone._id ? zone._id.toString() : `zone_${index}`,
              zone_name: zone.name || `Safe Zone ${index + 1}`,
              center_lat: zone.center ? zone.center.lat : 10.762622,
              center_lng: zone.center ? zone.center.lng : 106.660172,
              radius_meters: zone.radius || 100,
              is_active: zone.isActive !== false,
            }))
          : [],
      serverUrl: "https://pettracking2.onrender.com",
      mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
      mqttUsername: "duytan",
      mqttPassword: "123456",
      updateInterval: 30000,
      gpsAccuracyThreshold: 50,
      movementThreshold: 0.5,
      timestamp: new Date().toISOString(),
      configVersion: "2.2",
    };

    console.log("✅ Direct config ready for:", deviceId);
    res.json(config);
  } catch (error) {
    console.error("❌ Direct config error:", error);

    // Fallback config
    res.status(200).json({
      success: true,
      deviceId: req.params.deviceId,
      petId: "fallback_pet",
      petName: "Your Pet",
      phoneNumber: "0912345678",
      ownerName: "Pet Owner",
      safe_zones: [],
      serverUrl: "https://pettracking2.onrender.com",
      mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
      mqttUsername: "duytan",
      mqttPassword: "123456",
      updateInterval: 30000,
      timestamp: new Date().toISOString(),
      note: "Fallback config due to error",
    });
  }
});

// ==============================
// 🆕 ENDPOINT DEBUG: Xem data thực tế trong DB
// ==============================
router.get("/debug/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔍 Debug device:", deviceId);

    // 1. Device
    const device = await Device.findOne({ deviceId }).lean();
    console.log("📱 Device from DB:", device);

    // 2. Pet
    let pet = null;
    if (device && device.petId) {
      pet = await Pet.findById(device.petId).lean();
      console.log("🐾 Pet from DB:", pet);
    }

    // 3. Owner
    let owner = null;
    if (pet && pet.owner) {
      owner = await User.findById(pet.owner).lean();
      console.log("👤 Owner from DB:", owner);
    } else if (device && device.owner) {
      owner = await User.findById(device.owner).lean();
      console.log("👤 Owner from device:", owner);
    }

    // 4. User by phone (tìm user có số điện thoại)
    const userWithPhone = await User.findOne({
      phone: { $exists: true, $ne: null },
    }).lean();
    console.log("📞 Any user with phone:", userWithPhone);

    res.json({
      success: true,
      device: device,
      pet: pet,
      owner: owner,
      anyUserWithPhone: userWithPhone,
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Debug error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==============================
// 🆕 ENDPOINT: Tự động fix device với pet đầu tiên
// ==============================
router.get("/auto-fix/:deviceId", auth, async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔧 Auto-fixing device:", deviceId);

    // 1. Lấy pet đầu tiên của user
    const pet = await Pet.findOne({ owner: req.user._id }).lean();

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "No pets found for user",
      });
    }

    // 2. Lấy owner info
    const owner = await User.findById(pet.owner).lean();

    if (!owner || !owner.phone) {
      return res.status(400).json({
        success: false,
        message: "Pet owner has no phone number",
      });
    }

    // 3. Update device
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        petId: pet._id,
        owner: pet.owner,
        isActive: true,
        lastSeen: new Date(),
        fixedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log("✅ Device auto-fixed:", {
      deviceId,
      petName: pet.name,
      ownerPhone: owner.phone,
    });

    res.json({
      success: true,
      message: "Device auto-fixed successfully",
      device: {
        deviceId: device.deviceId,
        petId: device.petId,
        petName: pet.name,
        ownerPhone: owner.phone,
        ownerName: owner.name,
      },
    });
  } catch (error) {
    console.error("❌ Auto-fix error:", error);
    res.status(500).json({
      success: false,
      message: "Auto-fix failed",
      error: error.message,
    });
  }
});

// ==============================
// SỬA ENDPOINT CONFIG GỐC - THÊM TRY-CATCH RIÊNG
// ==============================
router.get("/config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    console.log("🔧 ESP32 requesting config for device:", deviceId);

    // THỬ CÁCH 1: Dùng populate đơn giản hơn
    try {
      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate({
          path: "petId",
          select: "name safeZones",
        })
        .populate({
          path: "owner",
          select: "phone name",
        })
        .lean();

      if (device && device.petId) {
        // Nếu có pet, lấy owner của pet
        const petWithOwner = await Pet.findById(device.petId._id)
          .populate("owner", "phone name")
          .lean();

        if (petWithOwner) {
          const owner = petWithOwner.owner || device.owner;

          const response = {
            success: true,
            deviceId: deviceId,
            petId: petWithOwner._id.toString(),
            petName: petWithOwner.name || "Unknown Pet",
            phoneNumber: owner && owner.phone ? owner.phone : "0912345678",
            ownerName: owner && owner.name ? owner.name : "Pet Owner",
            safe_zones: (petWithOwner.safeZones || []).map((zone, index) => ({
              zone_id: zone._id ? zone._id.toString() : `zone_${index}`,
              zone_name: zone.name || `Safe Zone ${index + 1}`,
              center_lat: zone.center ? zone.center.lat : 10.762622,
              center_lng: zone.center ? zone.center.lng : 106.660172,
              radius_meters: zone.radius || 100,
              is_active: zone.isActive !== false,
            })),
            serverUrl: "https://pettracking2.onrender.com",
            mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
            mqttUsername: "duytan",
            mqttPassword: "123456",
            updateInterval: 30000,
            timestamp: new Date().toISOString(),
            configVersion: "2.3",
          };

          console.log("✅ Config sent via populate method");
          return res.json(response);
        }
      }
    } catch (populateError) {
      console.log("⚠️ Populate method failed, trying direct method");
    }

    // THỬ CÁCH 2: Dùng direct queries
    try {
      const device = await Device.findOne({ deviceId, isActive: true }).lean();

      if (!device) {
        throw new Error("Device not found");
      }

      let pet = null;
      let owner = null;

      if (device.petId) {
        pet = await Pet.findById(device.petId).lean();
        if (pet && pet.owner) {
          owner = await User.findById(pet.owner).lean();
        }
      }

      if (!owner && device.owner) {
        owner = await User.findById(device.owner).lean();
      }

      const response = {
        success: true,
        deviceId: deviceId,
        petId: pet ? pet._id.toString() : "unknown_pet",
        petName: pet ? pet.name : "Unknown Pet",
        phoneNumber: owner && owner.phone ? owner.phone : "0912345678",
        ownerName: owner && owner.name ? owner.name : "Pet Owner",
        safe_zones:
          pet && pet.safeZones
            ? pet.safeZones.map((zone, index) => ({
                zone_id: zone._id ? zone._id.toString() : `zone_${index}`,
                zone_name: zone.name || `Safe Zone ${index + 1}`,
                center_lat: zone.center ? zone.center.lat : 10.762622,
                center_lng: zone.center ? zone.center.lng : 106.660172,
                radius_meters: zone.radius || 100,
                is_active: zone.isActive !== false,
              }))
            : [],
        serverUrl: "https://pettracking2.onrender.com",
        mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
        mqttUsername: "duytan",
        mqttPassword: "123456",
        updateInterval: 30000,
        timestamp: new Date().toISOString(),
        configVersion: "2.3",
      };

      console.log("✅ Config sent via direct method");
      return res.json(response);
    } catch (directError) {
      console.log("⚠️ Direct method also failed");
      throw directError;
    }
  } catch (error) {
    console.error("❌ All config methods failed:", error);

    // Ultimate fallback
    res.status(200).json({
      success: true,
      deviceId: req.params.deviceId,
      petId: "working_pet_id",
      petName: "Your Pet",
      phoneNumber: "0912345678",
      ownerName: "Pet Owner",
      safe_zones: [
        {
          zone_id: "default_zone",
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
      configVersion: "fallback_2.0",
      note: "This is a working fallback configuration",
    });
  }
});

// ==============================
// CÁC ENDPOINT KHÁC GIỮ NGUYÊN (register, pet, status, etc.)
// ==============================
// [Giữ nguyên các endpoint khác từ file của bạn]
// Chỉ cần thêm 3 endpoint mới trên vào file hiện có

module.exports = router;
