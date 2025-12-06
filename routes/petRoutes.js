const express = require("express");
const { body, validationResult } = require("express-validator");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// 🐾 Get all pets for current user
router.get("/my-pets", auth, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user._id });
    res.json({ success: true, count: pets.length, pets });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🐾 Get single pet (only owner can view)
router.get("/:id", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);
    if (!pet)
      return res.status(404).json({ success: false, message: "Pet not found" });
    if (pet.owner.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: "Access denied" });

    res.json({ success: true, pet });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🐾 Create new pet (auto assign owner)
router.post(
  "/",
  auth,
  [
    body("name").notEmpty().withMessage("Pet name is required"),
    body("species").notEmpty().withMessage("Species is required"),
    body("breed").notEmpty().withMessage("Breed is required"),
    body("age").isInt({ min: 0 }).withMessage("Age must be a positive number"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const pet = new Pet({ ...req.body, owner: req.user._id });
      await pet.save();

      res
        .status(201)
        .json({ success: true, message: "Pet created successfully", pet });
    } catch (error) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// 🐾 DELETE pet
router.delete("/:id", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    // Check if user owns the pet
    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete your own pets",
      });
    }

    // Delete the pet
    await Pet.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Pet deleted successfully",
    });
  } catch (error) {
    console.error("Delete pet error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting pet",
    });
  }
});

// ==============================
// 🆕 SAFE ZONES MANAGEMENT APIs
// ==============================

// 🐾 Add safe zone to pet
router.post("/:id/safezones", auth, async (req, res) => {
  try {
    const { name, center, radius, isActive } = req.body;

    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const newSafeZone = {
      name: name || "Safe Zone",
      center: {
        lat: parseFloat(center.lat),
        lng: parseFloat(center.lng),
      },
      radius: parseInt(radius) || 100,
      isActive: isActive !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    pet.safeZones.push(newSafeZone);
    await pet.save();

    res.json({
      success: true,
      message: "Safe zone added successfully",
      safeZone: newSafeZone,
      totalZones: pet.safeZones.length,
    });
  } catch (error) {
    console.error("Add safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while adding safe zone",
    });
  }
});

// 🐾 Get all safe zones for pet
router.get("/:id/safezones", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    res.json({
      success: true,
      safeZones: pet.safeZones || [],
      count: pet.safeZones.length,
    });
  } catch (error) {
    console.error("Get safe zones error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching safe zones",
    });
  }
});

// 🐾 Update safe zone
router.put("/:id/safezones/:zoneId", auth, async (req, res) => {
  try {
    const { name, center, radius, isActive } = req.body;

    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const zoneIndex = pet.safeZones.findIndex(
      (zone) => zone._id.toString() === req.params.zoneId
    );

    if (zoneIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Safe zone not found",
      });
    }

    // Update zone
    if (name) pet.safeZones[zoneIndex].name = name;
    if (center) {
      pet.safeZones[zoneIndex].center = {
        lat: parseFloat(center.lat),
        lng: parseFloat(center.lng),
      };
    }
    if (radius) pet.safeZones[zoneIndex].radius = parseInt(radius);
    if (isActive !== undefined) pet.safeZones[zoneIndex].isActive = isActive;
    pet.safeZones[zoneIndex].updatedAt = new Date();

    await pet.save();

    res.json({
      success: true,
      message: "Safe zone updated successfully",
      safeZone: pet.safeZones[zoneIndex],
    });
  } catch (error) {
    console.error("Update safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating safe zone",
    });
  }
});

// 🐾 Delete safe zone
router.delete("/:id/safezones/:zoneId", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const initialLength = pet.safeZones.length;
    pet.safeZones = pet.safeZones.filter(
      (zone) => zone._id.toString() !== req.params.zoneId
    );

    if (pet.safeZones.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: "Safe zone not found",
      });
    }

    await pet.save();

    res.json({
      success: true,
      message: "Safe zone deleted successfully",
      remainingZones: pet.safeZones.length,
    });
  } catch (error) {
    console.error("Delete safe zone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting safe zone",
    });
  }
});

module.exports = router;
