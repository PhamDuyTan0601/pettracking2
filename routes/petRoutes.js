const express = require("express");
const { body, validationResult } = require("express-validator");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

//  Get all pets for current user
router.get("/my-pets", auth, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user._id });
    res.json({ success: true, count: pets.length, pets });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get single pet (only owner can view)
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

// Create new pet
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

// DELETE pet
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

module.exports = router;
