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

module.exports = router;
