const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const app = express();

// CORS cho production
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "userId", "Authorization"],
  })
);

app.use(express.json());

// ===== API Routes =====
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/pets", require("./routes/petRoutes"));
app.use("/api/petData", require("./routes/petDataRoutes"));

// ===== Health Check =====
app.get("/health", (req, res) => {
  res.json({
    message: "✅ Pet Tracker API is running on Render!",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

// ===== Serve React SPA =====
app.use(express.static(path.join(__dirname, "build")));

// Wildcard route cho React SPA (Express 5 / Node 25)
app.get("/:path(*)", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

// ===== MongoDB Connection =====
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

module.exports = app;
