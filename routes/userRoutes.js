const express = require("express");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "mysecretkey";

router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("phone")
      .matches(/^(0|\+84)(3[2-9]|5[6|8|9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
      .withMessage("Số điện thoại Việt Nam không hợp lệ"),
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

      const { name, email, phone, password } = req.body;

      // Kiểm tra email đã tồn tại
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email already registered",
        });
      }

      // Kiểm tra số điện thoại đã tồn tại
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: "Số điện thoại already registered",
        });
      }

      const user = new User({ name, email, phone, password });
      await user.save();

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
      });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during registration",
        error: error.message,
      });
    }
  }
);

router.post(
  "/login",
  [
    body("email").notEmpty().withMessage("Email or phone is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await User.findOne({
        $or: [
          { email: email },
          { phone: email }, // Cho phép đăng nhập bằng số điện thoại
        ],
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Email/số điện thoại hoặc mật khẩu không đúng",
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Email/số điện thoại hoặc mật khẩu không đúng",
        });
      }

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
          phone: user.phone,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during login",
      });
    }
  }
);

//  Update profile

router.put(
  "/profile",
  auth,
  [
    body("phone")
      .optional()
      .matches(/^(0|\+84)(3[2-9]|5[6|8|9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
      .withMessage("Số điện thoại không hợp lệ"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, phone } = req.body;

      // Kiểm tra nếu số điện thoại đã được sử dụng bởi user khác
      if (phone) {
        const existingPhone = await User.findOne({
          phone,
          _id: { $ne: req.user._id },
        });
        if (existingPhone) {
          return res.status(400).json({
            success: false,
            message: "Số điện thoại đã được sử dụng",
          });
        }
      }

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone;

      const user = await User.findByIdAndUpdate(req.user._id, updateData, {
        new: true,
      }).select("-password");

      res.json({
        success: true,
        message: "Cập nhật thông tin thành công",
        user,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

//Get current user profile

router.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({ success: true, user });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
