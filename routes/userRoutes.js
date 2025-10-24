const express = require("express");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const User = require("../models/user");

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "mysecretkey";
const RESET_SECRET = process.env.RESET_SECRET || "resetSecretKey";

// ==============================
// 🧩 Register user
// ==============================
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

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: { id: user._id, name: user.name, email: user.email },
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
// 🔑 Login user
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
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==============================
// 🔁 Forgot Password (Send reset link via Gmail)
// ==============================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Email not found" });

    // Tạo reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 phút
    await user.save();

    // Gửi email bằng Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    await transporter.sendMail({
      from: `"Pet Tracker" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Password Reset Request",
      html: `
        <h3>Hello ${user.name},</h3>
        <p>Click the link below to reset your password (valid for 15 minutes):</p>
        <a href="${resetLink}" target="_blank">${resetLink}</a>
      `,
    });

    res.json({
      success: true,
      message: "Reset password email sent successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==============================
// 🔒 Reset Password (Verify token)
// ==============================
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const users = await User.find({
      resetPasswordExpires: { $gt: Date.now() },
    });
    const user = users.find((u) =>
      bcrypt.compareSync(token, u.resetPasswordToken)
    );

    if (!user)
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired token" });

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: "Password reset successful. You can now log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
