const express = require("express");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user");

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "mysecretkey";

// ==============================
// 🧩 Register user - ĐÃ CẬP NHẬT
// ==============================
router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("phoneNumber")
      .optional()
      .isMobilePhone()
      .withMessage("Số điện thoại không hợp lệ"), // ✅ THÊM
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, phoneNumber } = req.body; // ✅ THÊM phoneNumber
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ success: false, message: "Email already registered" });
      }

      const user = new User({ name, email, password, phoneNumber }); // ✅ THÊM phoneNumber

      await user.save();

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber, // ✅ THÊM
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);

// ==============================
// 🔑 Login user - ĐÃ CẬP NHẬT
// ==============================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(400)
        .json({ success: false, message: "Invalid password" });

    const token = jwt.sign({ userId: user._id }, SECRET_KEY, {
      expiresIn: "7d",
    });
    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber, // ✅ THÊM
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==============================
// 📞 Cập nhật thông tin user (bao gồm số điện thoại) - ✅ THÊM MỚI
// ==============================
router.put(
  "/profile",
  auth,
  [
    body("phoneNumber")
      .optional()
      .isMobilePhone()
      .withMessage("Số điện thoại không hợp lệ"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, phoneNumber } = req.body;

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

      const user = await User.findByIdAndUpdate(req.user._id, updateData, {
        new: true,
      }).select("-password");

      res.json({
        success: true,
        message: "Cập nhật thông tin thành công",
        user,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Lỗi server" });
    }
  }
);

// ==============================
// 👤 Lấy thông tin user hiện tại - ✅ THÊM MỚI
// ==============================
router.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
});

module.exports = router;
