const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/pets", require("./routes/petRoutes"));
app.use("/api/pet-data", require("./routes/petDataRoutes"));
app.use("/api/qr", require("./routes/qrRoutes"));
app.use("/api/wifi-devices", require("./routes/wifiDeviceRoutes")); // THÊM DÒNG NÀY

// QR Code generation - CẬP NHẬT ĐỂ HỖ TRỢ WIFI
app.get("/api/qr/generate/:deviceId", (req, res) => {
  const { deviceId } = req.params;

  const qrData = {
    type: "pet_tracker_wifi",
    deviceId: deviceId,
    deviceName: `PetTracker_${deviceId}`,
    wifiConfig: {
      ssid: "PetTracker_Network",
      password: "pet123456",
      encryption: "WPA2",
    },
    serverUrl: `${req.protocol}://${req.get("host")}`,
    pairingUrl: `${req.protocol}://${req.get("host")}/api/wifi-devices/pair`,
    timestamp: new Date().toISOString(),
  };

  res.json({
    success: true,
    qrData: qrData,
  });
});

// Web routes
app.get("/web", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/web/pair/:deviceId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => console.error("MongoDB connection error:", err));

module.exports = app;
