const mqtt = require("mqtt");

const options = {
  host: "u799c202.ala.dedicated.aws.emqxcloud.com",
  port: 1883,
  username: "duytan",
  password: "123456",
  clientId: "test_script_" + Date.now(),
  clean: true,
  reconnectPeriod: 1000,
  connectTimeout: 30000,
};

const deviceId = "ESP32_EC8A75B865E4";

console.log("🔗 Connecting to MQTT broker...");
console.log("Host:", options.host);
console.log("Username:", options.username);

const client = mqtt.connect(options);

client.on("connect", () => {
  console.log("✅ Connected to MQTT broker");

  // Subscribe to ESP32 topics
  const topics = [
    `pets/${deviceId}/#`,
    `pets/${deviceId}/location`,
    `pets/${deviceId}/status`,
    `pets/${deviceId}/alert`,
    `pets/${deviceId}/ack`,
  ];

  topics.forEach((topic) => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (!err) {
        console.log(`✅ Subscribed to: ${topic}`);
      } else {
        console.log(`❌ Failed to subscribe to ${topic}:`, err);
      }
    });
  });

  // Send test messages
  const testMessages = [
    {
      topic: `pets/${deviceId}/config`,
      message: JSON.stringify({
        deviceId: deviceId,
        command: "test_config",
        updateInterval: 30000,
        timestamp: new Date().toISOString(),
        testData: {
          phoneNumber: "+84901234567",
          serverUrl: "https://pettracking2.onrender.com",
        },
      }),
    },
    {
      topic: `pets/${deviceId}/command`,
      message: JSON.stringify({
        action: "send_status",
        reason: "test_request",
        timestamp: new Date().toISOString(),
      }),
    },
    {
      topic: `pets/${deviceId}/test`,
      message: "Hello ESP32 from Node.js test script!",
    },
  ];

  let delay = 2000;
  testMessages.forEach((msg, index) => {
    setTimeout(() => {
      console.log(`\n📤 Publishing to ${msg.topic}:`);
      console.log(msg.message);

      client.publish(msg.topic, msg.message, { qos: 1 }, (err) => {
        if (err) {
          console.log(`❌ Publish failed:`, err);
        } else {
          console.log(`✅ Published successfully`);
        }
      });
    }, delay * (index + 1));
  });
});

client.on("message", (topic, message) => {
  console.log("\n📨 MESSAGE RECEIVED:");
  console.log("Topic:", topic);
  console.log("Message:", message.toString());
  console.log("Length:", message.length, "bytes");
  console.log("Time:", new Date().toLocaleTimeString());
  console.log("---");
});

client.on("error", (err) => {
  console.log("❌ MQTT Error:", err);
});

client.on("close", () => {
  console.log("🔌 Connection closed");
});

client.on("reconnect", () => {
  console.log("🔄 Reconnecting...");
});

// Auto disconnect after 30 seconds
setTimeout(() => {
  console.log("\n⏰ Test completed, disconnecting...");
  client.end();
  process.exit(0);
}, 30000);
