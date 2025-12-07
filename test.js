// testExactTopic.js
const mqtt = require("mqtt");

console.log("🎯 TEST EXACT TOPIC MATCH");
console.log("=========================\n");

const DEVICE_ID = "ESP32_68C2470B65F4";

const client = mqtt.connect(
  "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
  {
    username: "duytan",
    password: "123456",
    clientId: `exact_test_${Date.now()}`,
  }
);

// Subscribe để xem tất cả
client.subscribe("#", { qos: 1 });

client.on("connect", () => {
  console.log("✅ Connected");

  console.log("\n📡 ESP32 is subscribed to:");
  console.log("   1. pets/ESP32_68C2470B65F4/config");
  console.log("   2. pets/+/config");
  console.log("   3. test/#");
  console.log("   4. # (all topics)");

  // Test 1: Gửi đến EXACT topic
  setTimeout(() => {
    console.log("\n🔹 TEST 1: Exact topic match");
    const exactTopic = "pets/ESP32_68C2470B65F4/config";
    const msg1 = {
      test: "EXACT_TOPIC_TEST",
      message: "This should definitely work!",
      timestamp: new Date().toISOString(),
    };

    console.log(`📤 Sending to: ${exactTopic}`);
    console.log("Message:", JSON.stringify(msg1, null, 2));

    client.publish(exactTopic, JSON.stringify(msg1), { qos: 1 }, (err) => {
      if (err) console.error("Error:", err);
    });
  }, 2000);

  // Test 2: Gửi với QoS 0
  setTimeout(() => {
    console.log("\n🔹 TEST 2: With QoS 0");
    const msg2 = {
      test: "QOS_0_TEST",
      qos: 0,
      message: "Testing different QoS level",
    };

    client.publish("pets/ESP32_68C2470B65F4/config", JSON.stringify(msg2), {
      qos: 0,
    });
    console.log("✅ Sent with QoS 0");
  }, 4000);

  // Test 3: Gửi với retain=false
  setTimeout(() => {
    console.log("\n🔹 TEST 3: Without retain flag");
    const msg3 = {
      test: "NO_RETAIN_TEST",
      retain: false,
      message: "Testing without retain",
    };

    client.publish("pets/ESP32_68C2470B65F4/config", JSON.stringify(msg3), {
      qos: 1,
      retain: false,
    });
    console.log("✅ Sent without retain");
  }, 6000);

  // Test 4: Gửi đến wildcard topic
  setTimeout(() => {
    console.log("\n🔹 TEST 4: Wildcard topic match");
    const msg4 = {
      test: "WILDCARD_TEST",
      message: "Should match pets/+/config",
    };

    client.publish("pets/ANYTHING/config", JSON.stringify(msg4), { qos: 1 });
    console.log("✅ Sent to pets/ANYTHING/config");
  }, 8000);
});

// Xem tất cả messages
client.on("message", (topic, message) => {
  console.log(`\n📥 RECEIVED on ${topic}:`);

  try {
    const data = JSON.parse(message.toString());

    // Highlight messages to ESP32
    if (topic.includes("ESP32") || topic.includes("config")) {
      console.log("🎯 THIS IS FOR ESP32!");
      console.log("Test:", data.test || "No test field");
    }

    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(message.toString());
  }
});

// Timeout
setTimeout(() => {
  console.log("\n" + "=".repeat(50));
  console.log("🧪 TEST COMPLETE");
  console.log("=".repeat(50));
  console.log("\n📋 ESP32 SHOULD RECEIVE:");
  console.log("   - Test 1: EXACT_TOPIC_TEST");
  console.log("   - Test 2: QOS_0_TEST");
  console.log("   - Test 3: NO_RETAIN_TEST");
  console.log("   - Test 4: WILDCARD_TEST");

  client.end();
  process.exit(0);
}, 12000);
