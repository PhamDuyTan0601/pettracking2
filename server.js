const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http"); // ⚠️ THÊM DÒNG NÀY
require("dotenv").config();

const app = express();

// ================================
// ✅ CORS CONFIG - THÊM ESP32
// ================================
app.use(
  cors({
    origin: [
      "https://pettracking.vercel.app",
      "http://localhost:3000",
      "*", // ⚠️ CHO PHÉP ESP32 KẾT NỐI
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "userId"],
    credentials: true,
  })
);

app.use(express.json());

// ================================
// 🔗 ROUTES (GIỮ NGUYÊN)
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
    message: "Pet Tracker API is running on Render!",
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
// 🚀 START SERVER - QUAN TRỌNG: THÊM HTTP
// ================================
const PORT = process.env.PORT || 5000;

// ⚠️ THÊM ĐOẠN NÀY - TẠO HTTP SERVER
const httpServer = http.createServer(app);
httpServer.listen(80, () => {
  console.log("🚀 HTTP Server running on port 80 (for ESP32)");
});

// GIỮ NGUYÊN SERVER HIỆN TẠI
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

module.exports = app;
