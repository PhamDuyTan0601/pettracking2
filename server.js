const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ================================
// ✅ CORS CONFIG - THÊM ESP32
// ================================
app.use(
  cors({
    origin: "*", // ⚠️ CHO PHÉP TẤT CẢ ESP32 KẾT NỐI
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "userId"],
    credentials: true,
  })
);

app.use(express.json());

// ================================
// 🔗 ROUTES
// ================================
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/pets", require("./routes/petRoutes"));
app.use("/api/petData", require("./routes/petDataRoutes"));
app.use("/api/devices", require("./routes/deviceRoutes"));

// ================================
// 💓 HEALTH CHECK - THÊM ENDPOINT NÀY
// ================================
app.get("/health", (req, res) => {
  res.status(200).json({
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "Pet Tracker API is running on Render!",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    environment: process.env.NODE_ENV || "development",
  });
});

// ================================
// 🧠 DATABASE CONNECTION
// ================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => {
    console.log("❌ MongoDB Connection Error:", err);
    process.exit(1); // Thoát nếu không kết nối được database
  });

// ================================
// 🚀 START SERVER - SỬA LẠI PHẦN NÀY
// ================================
const PORT = process.env.PORT || 10000;

// Đảm bảo server lắng nghe trên tất cả interfaces
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Xử lý lỗi khởi động server
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`❌ Port ${PORT} is already in use`);
  } else {
    console.log("❌ Server error:", err);
  }
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});

module.exports = app;
