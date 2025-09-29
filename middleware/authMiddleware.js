const User = require("../models/user");
const mongoose = require("mongoose");

const auth = async (req, res, next) => {
  try {
    console.log("=== AUTH DEBUG ===");
    console.log("All headers:", req.headers);
    console.log("All query params:", req.query);
    console.log("All body data:", req.body);

    // Nhận userId từ nhiều nguồn
    let userId =
      req.headers.userId ||
      req.headers.userid ||
      req.headers["user-id"] ||
      req.query.userId ||
      req.body.userId;

    console.log("Extracted userId:", userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required. Please provide user ID in headers, query, or body",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user ID format: " + userId,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found with ID: " + userId,
      });
    }

    console.log("Authentication successful for user:", user.name);
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication failed",
      error: error.message,
    });
  }
};

module.exports = auth;
