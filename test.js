// checkDeviceId.js
const mqtt = require("mqtt");

console.log("🔍 Checking Device ID Match");
console.log("===========================\n");

// Test với cả 2 device IDs
const deviceIds = ["ESP32_68C2470B65F4", "ESP32_EC8A75B865E4"];

const client = mqtt.connect(
  "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
  {
    username: "duytan",
    password: "123456",
    clientId: `checker_${Date.now()}`,
  }
);

client.on("connect", () => {
  console.log("✅ Connected to MQTT\n");

  // Subscribe to both topics
  deviceIds.forEach((deviceId) => {
    const topic = `pets/${deviceId}/config`;
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`📡 Subscribed to: ${topic}`);
      }
    });
  });

  // Publish test messages
  setTimeout(() => {
    console.log("\n📤 Publishing test messages...");

    deviceIds.forEach((deviceId, index) => {
      setTimeout(() => {
        const testMsg = {
          deviceId: deviceId,
          test: `Message for ${deviceId}`,
          timestamp: new Date().toISOString(),
          number: index + 1,
        };

        const topic = `pets/${deviceId}/config`;
        console.log(`\n🔹 Publishing to ${topic}:`, JSON.stringify(testMsg));

        client.publish(topic, JSON.stringify(testMsg), { qos: 1 }, (err) => {
          if (err) {
            console.error(`❌ Publish failed:`, err);
          } else {
            console.log(`✅ Published`);
          }
        });
      }, index * 2000);
    });

    // End test
    setTimeout(() => {
      console.log("\n🧪 Test complete!");
      console.log("Check which device ID ESP32 actually receives");
      client.end();
      process.exit(0);
    }, 6000);
  }, 2000);
});

// Handle messages
client.on("message", (topic, message) => {
  console.log(`\n🎯 RECEIVED on ${topic}:`);
  console.log(JSON.parse(message.toString()));

  // Check device ID match
  const data = JSON.parse(message.toString());
  const topicDeviceId = topic.split("/")[1];

  if (data.deviceId === topicDeviceId) {
    console.log(`✅ Device ID MATCH: ${data.deviceId}`);
  } else {
    console.log(`❌ Device ID MISMATCH!`);
    console.log(`   Topic: ${topicDeviceId}`);
    console.log(`   Message: ${data.deviceId}`);
  }
});

client.on("error", (err) => {
  console.error("❌ MQTT error:", err);
  process.exit(1);
});
