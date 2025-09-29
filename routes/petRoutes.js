const express = require("express");
const { body, validationResult } = require("express-validator");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware"); // THÊM DÒNG NÀY

const router = express.Router();

// Get all pets for CURRENT USER (PHAN QUYEN)
router.get("/my-pets", auth, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user._id });

    res.json({
      success: true,
      count: pets.length,
      pets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Get all pets (public for demo) - XOA HOAC SUA
router.get("/", async (req, res) => {
  try {
    // CHI HIEN THI PET CUA USER HIEN TAI NEU CO AUTH
    const { userId } = req.query;
    let query = {};

    if (userId) {
      query.owner = userId;
    }

    const pets = await Pet.find(query).populate("owner", "name email");
    res.json({
      success: true,
      count: pets.length,
      pets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Get single pet - CHI OWNER MOI DUOC XEM
router.get("/:id", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    // PHAN QUYEN: chi owner moi duoc xem
    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own pets",
      });
    }

    const populatedPet = await Pet.findById(req.params.id).populate(
      "owner",
      "name email"
    );
    res.json({ success: true, pet: populatedPet });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Create new pet - TU DONG GAN OWNER
router.post(
  "/",
  auth, // THEM AUTH
  [
    body("name").notEmpty().withMessage("Pet name is required"),
    body("species")
      .isIn(["dog", "cat", "other"])
      .withMessage("Valid species is required"),
    body("breed").notEmpty().withMessage("Breed is required"),
    body("age").isInt({ min: 0 }).withMessage("Age must be a positive number"),
    // XOA body("owner") vi se tu dong gan
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // TU DONG GAN OWNER TU AUTH
      const petData = {
        ...req.body,
        owner: req.user._id,
      };

      const pet = new Pet(petData);
      await pet.save();

      res.status(201).json({
        success: true,
        message: "Pet created successfully",
        pet,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// Update pet - CHI OWNER MOI DUOC SUA
router.put("/:id", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    // PHAN QUYEN: chi owner moi duoc sua
    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update your own pets",
      });
    }

    const updatedPet = await Pet.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Pet updated successfully",
      pet: updatedPet,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Delete pet - CHI OWNER MOI DUOC XOA
router.delete("/:id", auth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.id);

    if (!pet) {
      return res.status(404).json({
        success: false,
        message: "Pet not found",
      });
    }

    // PHAN QUYEN: chi owner moi duoc xoa
    if (pet.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete your own pets",
      });
    }

    await Pet.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Pet deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
