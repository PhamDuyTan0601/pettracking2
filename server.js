const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

// Import MQTT Service
const mqttService = require("./mqttSubscriber");

const app = express();

// ================================
// ✅ CORS CONFIG
// ================================
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://pet-mu-seven.vercel.app",
      "https://trackingsytem06.vercel.app",
      "*",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// ================================
// 🔗 ROUTES
// ================================
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/pets", require("./routes/petRoutes"));
app.use("/api/pets", require("./routes/safeZoneRoutes"));
app.use("/api/petData", require("./routes/petDataRoutes"));
app.use("/api/devices", require("./routes/deviceRoutes"));

console.log("✅ All routes loaded successfully");

// ================================
// 💓 HEALTH CHECK
// ================================
app.get("/", (req, res) => {
  res.json({
    message: "Pet Tracker API is running!",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    mqtt: mqttService.getConnectionStatus() ? "Connected" : "Disconnected",
    status: "healthy",
    version: "1.3.0",
    features: ["auto-config", "safe-zones", "mqtt-realtime"],
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    mqtt: mqttService.getConnectionStatus() ? "connected" : "disconnected",
  });
});

// ================================
// 🧠 DATABASE CONNECTION
// ================================
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing in environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected Successfully");

    // Khởi động MQTT Service sau khi DB connected
    mqttService.connect();
  } catch (error) {
    console.log("❌ MongoDB Connection Error:", error.message);
    console.log("⚠️  Server continuing without MongoDB...");
  }
};

connectDB();

// ================================
// 🚀 START SERVER
// ================================
const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HTTP Server running on port ${PORT}`);
  console.log(`🌐 Server URL: http://0.0.0.0:${PORT}`);
  console.log(`💓 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`🔧 ESP32 Config: GET /api/devices/config/{deviceId}`);
  console.log(`📤 Publish Config: POST /api/devices/config/publish/{deviceId}`);
  console.log(`\n📡 MQTT Topics:`);
  console.log(`   • pets/{deviceId}/location`);
  console.log(`   • pets/{deviceId}/config`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

module.exports = app;
