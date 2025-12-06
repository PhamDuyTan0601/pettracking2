const express = require("express");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware");
const router = express.Router();

// 🛡️ Thêm vùng an toàn cho pet
router.post("/:petId/safe-zones", auth, async (req, res) => {
  try {
    const { petId } = req.params;
    const { name, center, radius } = req.body;

    // Kiểm tra pet thuộc về user
    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    // Validate center coordinates
    if (
      !center ||
      typeof center.lat !== "number" ||
      typeof center.lng !== "number"
    ) {
      return res.status(400).json({
        success: false,
        message: "Tọa độ vùng an toàn không hợp lệ",
      });
    }

    // Validate radius
    if (radius < 10 || radius > 5000) {
      return res.status(400).json({
        success: false,
        message: "Bán kính phải từ 10m đến 5000m",
      });
    }

    // Thêm safe zone mới
    const newSafeZone = {
      name: name || "Vùng an toàn",
      center: {
        lat: center.lat,
        lng: center.lng,
      },
      radius: radius || 100,
      isActive: true,
    };

    pet.safeZones.push(newSafeZone);
    await pet.save();

    console.log(
      "✅ Added safe zone for pet:",
      pet.name,
      "radius:",
      radius,
      "m"
    );

    res.json({
      success: true,
      message: "Safe zone added successfully",
      safeZone: newSafeZone,
      pet: {
        id: pet._id,
        name: pet.name,
      },
    });
  } catch (error) {
    console.error("❌ Add safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🛡️ Lấy danh sách safe zones của pet
router.get("/:petId/safe-zones", auth, async (req, res) => {
  try {
    const { petId } = req.params;

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id }).select(
      "safeZones name"
    );

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    res.json({
      success: true,
      safeZones: pet.safeZones || [],
      petName: pet.name,
    });
  } catch (error) {
    console.error("❌ Get safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🛡️ Cập nhật safe zone
router.put("/:petId/safe-zones/:zoneId", auth, async (req, res) => {
  try {
    const { petId, zoneId } = req.params;
    const updates = req.body;

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    const zoneIndex = pet.safeZones.findIndex(
      (zone) => zone._id.toString() === zoneId
    );

    if (zoneIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Safe zone not found",
      });
    }

    // Cập nhật thông tin
    Object.keys(updates).forEach((key) => {
      if (key === "center") {
        pet.safeZones[zoneIndex].center = {
          ...pet.safeZones[zoneIndex].center,
          ...updates.center,
        };
      } else if (key !== "_id") {
        pet.safeZones[zoneIndex][key] = updates[key];
      }
    });

    await pet.save();

    res.json({
      success: true,
      message: "Safe zone updated successfully",
      safeZone: pet.safeZones[zoneIndex],
    });
  } catch (error) {
    console.error("❌ Update safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🛡️ Kích hoạt/deactivate safe zone
router.patch("/:petId/safe-zones/:zoneId/toggle", auth, async (req, res) => {
  try {
    const { petId, zoneId } = req.params;

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    const zoneIndex = pet.safeZones.findIndex(
      (zone) => zone._id.toString() === zoneId
    );

    if (zoneIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Safe zone not found",
      });
    }

    // Toggle trạng thái
    pet.safeZones[zoneIndex].isActive = !pet.safeZones[zoneIndex].isActive;
    await pet.save();

    res.json({
      success: true,
      message: `Safe zone ${
        pet.safeZones[zoneIndex].isActive ? "activated" : "deactivated"
      } successfully`,
      safeZone: pet.safeZones[zoneIndex],
    });
  } catch (error) {
    console.error("❌ Toggle safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🛡️ Xóa safe zone
router.delete("/:petId/safe-zones/:zoneId", auth, async (req, res) => {
  try {
    const { petId, zoneId } = req.params;

    const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found or access denied",
      });
    }

    // Lọc ra zone cần xóa
    const zoneToDelete = pet.safeZones.find(
      (zone) => zone._id.toString() === zoneId
    );
    if (!zoneToDelete) {
      return res.status(404).json({
        success: false,
        message: "Safe zone not found",
      });
    }

    pet.safeZones = pet.safeZones.filter(
      (zone) => zone._id.toString() !== zoneId
    );

    await pet.save();

    console.log(
      "🗑️ Deleted safe zone:",
      zoneToDelete.name,
      "from pet:",
      pet.name
    );

    res.json({
      success: true,
      message: "Safe zone deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
