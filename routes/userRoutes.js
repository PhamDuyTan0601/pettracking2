const express = require("express");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const User = require("../models/user");

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "mysecretkey";

// Register user
router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ success: false, message: "Email already registered" });
      }

      const user = new User({ name, email, password });
      await user.save();

      res
        .status(201)
        .json({ success: true, message: "User registered successfully", user });
    } catch (error) {
      res
        .status(500)
        .json({
          success: false,
          message: "Server error",
          error: error.message,
        });
    }
  }
);

// Login user
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").exists().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, password } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        return res
          .status(400)
          .json({ success: false, message: "User not found" });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid credentials" });
      }

      // ✅ Tạo JWT token
      const token = jwt.sign({ id: user._id }, SECRET_KEY, { expiresIn: "7d" });

      res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error",
          error: error.message,
        });
    }
  }
);

module.exports = router;
