const mongoose = require("mongoose");
require("dotenv").config();

async function fixDeviceIdIssue() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const Device = require("./models/device");

    console.log("🔧 FIXING DEVICE ID ISSUE");
    console.log("=".repeat(50));

    // 1. Kiểm tra device sai
    const wrongDevice = await Device.findOne({
      deviceId: "ESP32_EC8A75B865E4",
    })
      .populate("petId", "name")
      .populate("owner", "name");

    if (wrongDevice) {
      console.log("❌ Found WRONG device in DB:");
      console.log(`   Device ID: ${wrongDevice.deviceId}`);
      console.log(`   Pet: ${wrongDevice.petId?.name || "None"}`);
      console.log(`   Owner: ${wrongDevice.owner?.name || "None"}`);

      // Xóa device sai
      await Device.deleteOne({ _id: wrongDevice._id });
      console.log("✅ Deleted wrong device from DB");
    } else {
      console.log("✅ No wrong device found in DB");
    }

    // 2. Kiểm tra device đúng
    const correctDevice = await Device.findOne({
      deviceId: "ESP32_68C2470B65F4",
    })
      .populate("petId", "name")
      .populate("owner", "name");

    if (correctDevice) {
      console.log("\n✅ Found CORRECT device:");
      console.log(`   Device ID: ${correctDevice.deviceId}`);
      console.log(`   Pet: ${correctDevice.petId?.name || "None"}`);
      console.log(`   Owner: ${correctDevice.owner?.name || "None"}`);
      console.log(`   Active: ${correctDevice.isActive}`);

      // Đảm bảo configSent = false để server auto-send config
      if (!correctDevice.configSent) {
        console.log("ℹ️  Device marked for auto-config on next location");
      }
    } else {
      console.log("\n❌ Correct device NOT FOUND in DB");
      console.log("   Please register device first via web interface");
    }

    // 3. Liệt kê tất cả devices
    const allDevices = await Device.find({})
      .populate("petId", "name")
      .populate("owner", "name");

    console.log("\n📊 ALL DEVICES IN DATABASE:");
    console.log("=".repeat(50));

    if (allDevices.length === 0) {
      console.log("No devices found");
    } else {
      allDevices.forEach((device, index) => {
        console.log(`${index + 1}. ${device.deviceId}`);
        console.log(`   Pet: ${device.petId?.name || "None"}`);
        console.log(`   Owner: ${device.owner?.name || "None"}`);
      });
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Fix completed!");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

// Chạy fix
fixDeviceIdIssue();
