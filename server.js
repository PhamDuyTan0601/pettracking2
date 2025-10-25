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
// 💓 HEALTH CHECK
// ================================
app.get("/", (req, res) => {
  res.json({
    message: "Pet Tracker API is running on Render! (HTTP)",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

// ================================
// 🧠 DATABASE CONNECTION
// ================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => console.log("❌ MongoDB Connection Error:", err));

// ================================
// 🚀 START SERVER - CHỈ CẦN 1 SERVER
// ================================
const PORT = process.env.PORT || 10000; // ⚠️ DÙNG PORT 10000

app.listen(PORT, () => {
  console.log(`🚀 HTTP Server running on port ${PORT} (for ESP32)`);
});

module.exports = app;
