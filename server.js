const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

console.log("🔧 Environment Check:");
console.log("PORT:", process.env.PORT);
console.log("MONGO_URI:", process.env.MONGO_URI ? "✅ Found" : "❌ Missing");

const app = express();

// ================================
// ✅ CORS CONFIG
// ================================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "userId"],
    credentials: true,
  })
);

app.use(express.json());

// ================================
// 🔗 ROUTES
// ================================
try {
  app.use("/api/users", require("./routes/userRoutes"));
  app.use("/api/pets", require("./routes/petRoutes"));
  app.use("/api/petData", require("./routes/petDataRoutes"));
  app.use("/api/devices", require("./routes/deviceRoutes"));
  console.log("✅ All routes loaded successfully");
} catch (error) {
  console.error("❌ Route loading error:", error);
}

// ================================
// 💓 HEALTH CHECK - QUAN TRỌNG CHO RAILWAY
// ================================
app.get("/", (req, res) => {
  res.json({
    message: "Pet Tracker API is running on Railway!",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    status: "healthy",
  });
});

// 🆕 HEALTH CHECK ENDPOINT CHO RAILWAY
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ================================
// 🧠 DATABASE CONNECTION
// ================================
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully"))
    .catch((err) => {
      console.log("❌ MongoDB Connection Error:", err.message);
      // 🚨 KHÔNG EXIT - CHO SERVER CHẠY DÙ KHÔNG CÓ DB
      console.log("⚠️  Server continuing without MongoDB...");
    });
} else {
  console.log("❌ MONGO_URI is missing");
}

// ================================
// 🚀 START SERVER - THÊM ERROR HANDLING
// ================================
const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HTTP Server running on port ${PORT}`);
  console.log(`🌐 Server URL: http://0.0.0.0:${PORT}`);
  console.log(`💓 Health check: http://0.0.0.0:${PORT}/health`);
});

// 🆕 HANDLE GRACEFUL SHUTDOWN
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

// 🆕 KEEP PROCESS ALIVE
setInterval(() => {
  console.log(
    `❤️  Keep-alive: Server running for ${Math.floor(process.uptime())} seconds`
  );
}, 60000); // Log mỗi 60 giây

module.exports = app;
