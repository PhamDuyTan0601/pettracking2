const jwt = require("jsonwebtoken");
const User = require("../models/user");

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided. Please login again.",
      });
    }

    // Lấy token (bỏ prefix 'Bearer ')
    const token = authHeader.replace("Bearer ", "").trim();

    // Giải mã token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Hỗ trợ nhiều kiểu field khác nhau (id, userId, _id)
    const userId = decoded.userId || decoded.id || decoded._id || decoded.user;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    // Tìm user trong DB
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Lưu thông tin user vào request
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({
      success: false,
      message: "Authentication failed",
      error: error.message,
    });
  }
};

module.exports = auth;
