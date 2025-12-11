const express = require("express");
const { body, validationResult } = require("express-validator");
const PetData = require("../models/petData");
const Pet = require("../models/pet");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// Submit pet data from ESP32 (public access)
router.post(
  "/",
  [
    body("petId").notEmpty().withMessage("Pet ID is required"),
    body("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude is required"),
    body("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude is required"),
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

      const petData = new PetData(req.body);
      await petData.save();

      res.status(201).json({
        success: true,
        message: "Pet data saved successfully",
        data: petData,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// Get pet data
router.get("/pet/:petId", auth, async (req, res) => {
  try {
    const { petId } = req.params;
    const { start, end, limit = 1000 } = req.query;

    // Check if pet exists and belongs to owner
    const pet = await Pet.findById(petId);
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
        message: "Access denied. You can only view data of your own pets",
      });
    }

    // Build query
    let query = { petId };
    if (start || end) {
      query.timestamp = {};
      if (start) query.timestamp.$gte = new Date(start);
      if (end) query.timestamp.$lte = new Date(end);
    }

    const petData = await PetData.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: petData.length,
      data: petData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// CHI OWNER MOI DUOC XEM
router.get("/pet/:petId/latest", auth, async (req, res) => {
  try {
    const { petId } = req.params;

    // Check ownership
    const pet = await Pet.findById(petId);
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

    const latestData = await PetData.findOne({ petId }).sort({ timestamp: -1 });
    res.json({
      success: true,
      data: latestData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

//  XOA HOAC THEM PHAN QUYEN
router.get("/", auth, async (req, res) => {
  try {
    // CHI HIEN THI PET DATA CUA PET MA USER SO HUU
    const userPets = await Pet.find({ owner: req.user._id });
    const petIds = userPets.map((pet) => pet._id);

    const data = await PetData.find({ petId: { $in: petIds } })
      .limit(100)
      .sort({ timestamp: -1 })
      .populate("petId", "name");

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;
