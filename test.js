// test-new-device.js
const mqtt = require("mqtt");

console.log("🔗 Testing NEW Device: ESP32_68C2470B65F4...");

const config = {
  host: "u799c202.ala.dedicated.aws.emqxcloud.com",
  port: 1883,
  username: "duytan",
  password: "123456",
  clientId: "pettracker",
};

const NEW_DEVICE_ID = "8622";

const client = mqtt.connect(config);

client.on("connect", () => {
  console.log("✅ CONNECTED to EMQX!");
  console.log("📱 Testing Device:", NEW_DEVICE_ID);
  console.log("----------------------------------------");

  // Subscribe to new device topics
  client.subscribe(`pets/${NEW_DEVICE_ID}/location`, (err) => {
    if (err) {
      console.log("❌ SUBSCRIBE failed:", err.message);
    } else {
      console.log("✅ SUBSCRIBED to device topic");

      // Test publish to new device
      const testData = {
        deviceId: NEW_DEVICE_ID,
        latitude: 10.762622,
        longitude: 106.660172,
        batteryLevel: 95,
        speed: 1.2,
        timestamp: Date.now(),
        test: "new_device_test",
      };

      client.publish(
        `pets/${NEW_DEVICE_ID}/location`,
        JSON.stringify(testData),
        (err) => {
          if (err) {
            console.log("❌ PUBLISH failed:", err.message);
          } else {
            console.log("✅ PUBLISH successful to new device");
            console.log("📍 Data:", {
              lat: testData.latitude,
              lng: testData.longitude,
              battery: testData.batteryLevel + "%",
            });
          }
        }
      );
    }
  });
});

client.on("message", (topic, message) => {
  console.log(`\n📨 MESSAGE RECEIVED [${topic}]:`);
  console.log(JSON.parse(message.toString()));
});

client.on("error", (error) => {
  console.error("❌ CONNECTION ERROR:", error.message);
});

setTimeout(() => {
  console.log("\n🎯 Test completed");
  client.end();
  process.exit(0);
}, 8000);
