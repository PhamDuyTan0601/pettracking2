const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

// Import MQTT Service
const mqttService = require("./mqttSubscriber");

const app = express();

// ================================
// ⚡ RATE LIMITING
// ================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Áp dụng rate limiting cho API routes
app.use("/api/", limiter);

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
    endpoints: {
      health: "/health",
      deviceConfig: "/api/devices/config/{deviceId}",
      deviceTest: "/api/devices/test/{deviceId}",
      triggerConfig: "/api/devices/trigger-config/{deviceId}",
      debug: "/debug/*",
    },
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
    serverUrl: process.env.SERVER_URL || "https://pettracking2.onrender.com",
    env: process.env.NODE_ENV || "development",
  });
});

// ================================
// 🔧 DEBUG ENDPOINTS
// ================================
app.get("/debug/mqtt-status", (req, res) => {
  res.json({
    mqttConnected: mqttService.getConnectionStatus(),
    broker: "u799c202.ala.dedicated.aws.emqxcloud.com:1883",
    username: "duytan",
    timestamp: new Date().toISOString(),
  });
});

app.get("/debug/device-config/:deviceId", async (req, res) => {
  try {
    const Device = require("./models/device");
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate("petId", "name safeZones")
      .populate("owner", "name phone");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    // Kiểm tra config có sẵn để gửi
    const configReady = device.petId && device.owner && device.owner.phone;

    res.json({
      success: true,
      device: {
        deviceId: device.deviceId,
        isActive: device.isActive,
        configSent: device.configSent,
        lastConfigSent: device.lastConfigSent,
        lastSeen: device.lastSeen,
        pet: device.petId
          ? {
              name: device.petId.name,
              safeZonesCount: device.petId.safeZones?.length || 0,
              hasSafeZones:
                device.petId.safeZones && device.petId.safeZones.length > 0,
            }
          : null,
        owner: device.owner
          ? {
              name: device.owner.name,
              phone: device.owner.phone,
              hasPhone: !!device.owner.phone,
            }
          : null,
        configReady: configReady,
        canSendConfig: configReady && mqttService.getConnectionStatus(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger config send từ web (no auth)
app.get("/debug/send-config/:deviceId", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;

    console.log(`🔧 Manual config send triggered for: ${deviceId}`);

    // Kiểm tra device
    const Device = require("./models/device");
    const device = await Device.findOne({ deviceId: deviceId });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    // Gửi config ngay lập tức
    await mqttService.manualPublishConfig(deviceId);

    // Cập nhật trạng thái
    device.configSent = true;
    device.lastConfigSent = new Date();
    await device.save();

    res.json({
      success: true,
      message: "Config sent to device via MQTT",
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Kiểm tra tất cả devices
app.get("/debug/devices", async (req, res) => {
  try {
    const Device = require("./models/device");
    const devices = await Device.find({})
      .populate("petId", "name")
      .populate("owner", "phone")
      .limit(20)
      .sort({ createdAt: -1 });

    res.json({
      total: devices.length,
      mqttConnected: mqttService.getConnectionStatus(),
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        petId: d.petId?._id,
        petName: d.petId?.name,
        ownerPhone: d.owner?.phone,
        isActive: d.isActive,
        configSent: d.configSent,
        lastSeen: d.lastSeen,
        createdAt: d.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check specific device
app.get("/debug/device/:deviceId", async (req, res) => {
  try {
    const Device = require("./models/device");
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate("petId", "name safeZones")
      .populate("owner", "name phone");

    if (!device) {
      return res.status(404).json({
        found: false,
        message: "Device not found",
      });
    }

    res.json({
      found: true,
      device: {
        deviceId: device.deviceId,
        pet: device.petId
          ? {
              name: device.petId.name,
              safeZonesCount: device.petId.safeZones?.length || 0,
              safeZones: device.petId.safeZones,
            }
          : null,
        owner: device.owner
          ? {
              name: device.owner.name,
              phone: device.owner.phone,
            }
          : null,
        isActive: device.isActive,
        configSent: device.configSent,
        lastSeen: device.lastSeen,
        lastConfigSent: device.lastConfigSent,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test MQTT connection
app.get("/debug/test-mqtt/:deviceId", async (req, res) => {
  try {
    const deviceId = req.params.deviceId;

    // Test data
    const testData = {
      test: true,
      deviceId: deviceId,
      timestamp: new Date().toISOString(),
      message: "Test from server debug endpoint",
      server: process.env.SERVER_URL || "https://pettracking2.onrender.com",
    };

    // Publish test message
    const topic = `pets/${deviceId}/test`;
    mqttService.client.publish(
      topic,
      JSON.stringify(testData),
      { qos: 1 },
      (err) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "MQTT publish failed",
            error: err.message,
          });
        }

        res.json({
          success: true,
          message: "Test message sent via MQTT",
          deviceId: deviceId,
          topic: topic,
          data: testData,
          mqttConnected: mqttService.getConnectionStatus(),
        });
      }
    );
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
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

// Database event listeners
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
  console.log("MongoDB reconnected");
});

connectDB();

// ================================
// 🚨 ERROR HANDLER MIDDLEWARE (Global)
// ================================
app.use((err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message: message,
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// ================================
// 🚀 START SERVER
// ================================
const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  🚀 PET TRACKER SERVER STARTED
  ==========================================
  🌐 HTTP Server: http://0.0.0.0:${PORT}
  📡 Server URL: ${
    process.env.SERVER_URL || "https://pettracking2.onrender.com"
  }
  ==========================================
  
  🔧 MAIN ENDPOINTS:
  💓 Health Check: GET /health
  📱 Device Config: GET /api/devices/config/{deviceId}
  🔍 Device Test: GET /api/devices/test/{deviceId}
  🚀 Trigger Config: POST /api/devices/trigger-config/{deviceId}
  
  🔧 DEBUG ENDPOINTS:
  📊 MQTT Status: GET /debug/mqtt-status
  📱 Device Info: GET /debug/device-config/{deviceId}
  🚀 Send Config: GET /debug/send-config/{deviceId}
  📋 All Devices: GET /debug/devices
  🔍 Device Detail: GET /debug/device/{deviceId}
  🧪 Test MQTT: GET /debug/test-mqtt/{deviceId}
  
  📡 MQTT BROKER:
  🔗 Broker: u799c202.ala.dedicated.aws.emqxcloud.com:1883
  👤 Username: duytan
  📌 Topics:
      • pets/{deviceId}/location (subscribe)
      • pets/{deviceId}/config (publish with retain)
      • pets/{deviceId}/status (subscribe)
      • pets/{deviceId}/alert (subscribe)
  
  ==========================================
  ✅ Server ready to receive ESP32 connections!
  ==========================================
  `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");

  // Close MQTT connection
  if (mqttService.client) {
    mqttService.client.end();
  }

  server.close(() => {
    console.log("✅ Server closed");
    mongoose.connection.close(false, () => {
      console.log("✅ MongoDB connection closed");
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down");

  if (mqttService.client) {
    mqttService.client.end();
  }

  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});

module.exports = app;
