const mqtt = require("mqtt");

// Cấu hình MQTT của bạn
const config = {
  brokerUrl: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
  username: "duytan",
  password: "123456",
  deviceId: "ESP32_68C2470B65F4",
};

console.log("🔧 MQTT Test Configuration:");
console.log("==========================");
console.log("Broker:", config.brokerUrl);
console.log("Username:", config.username);
console.log("Device ID:", config.deviceId);
console.log("==========================\n");

// Tạo topics
const topics = {
  location: `pets/${config.deviceId}/location`,
  status: `pets/${config.deviceId}/status`,
  config: `pets/${config.deviceId}/config`,
  alert: `pets/${config.deviceId}/alert`,
  test: `pets/${config.deviceId}/test`,
};

// Kết nối MQTT
console.log("🔗 Connecting to MQTT broker...");
const client = mqtt.connect(config.brokerUrl, {
  username: config.username,
  password: config.password,
  clientId: `test_client_${Date.now()}`,
  clean: true,
});

client.on("connect", () => {
  console.log("✅ Connected to MQTT broker!\n");

  // Subscribe các topics
  Object.values(topics).forEach((topic) => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.log(`❌ Failed to subscribe to ${topic}:`, err.message);
      } else {
        console.log(`✅ Subscribed to: ${topic}`);
      }
    });
  });

  // Gửi test config message
  setTimeout(() => {
    sendTestConfig();
  }, 2000);

  // Gửi test message
  setTimeout(() => {
    sendTestMessage();
  }, 4000);

  // Request location từ ESP32
  setTimeout(() => {
    requestLocation();
  }, 6000);
});

client.on("message", (topic, message) => {
  console.log(`\n📨 Message received [${topic}]:`);
  try {
    const data = JSON.parse(message.toString());
    console.log(JSON.stringify(data, null, 2));

    // Xử lý location data
    if (topic === topics.location) {
      console.log("📍 Location data received:");
      console.log(`   Lat: ${data.latitude}, Lng: ${data.longitude}`);
      console.log(`   Speed: ${data.speed} m/s`);
      console.log(`   Battery: ${data.batteryLevel}%`);
    }

    // Xử lý status data
    if (topic === topics.status) {
      console.log("🔋 Device status:");
      console.log(`   Battery: ${data.batteryLevel}%`);
      console.log(`   RSSI: ${data.rssi} dBm`);
      console.log(`   Config received: ${data.configReceived}`);
      console.log(`   Need config: ${data.needConfig}`);
    }
  } catch (error) {
    console.log("Raw message:", message.toString());
  }
});

client.on("error", (error) => {
  console.error("❌ MQTT Error:", error);
});

client.on("close", () => {
  console.log("🔌 MQTT connection closed");
});

// Hàm gửi test config
function sendTestConfig() {
  const configData = {
    success: true,
    _source: "test_server",
    deviceId: config.deviceId,
    petId: "test_pet_123",
    petName: "Test Buddy",
    phoneNumber: "0987654321",
    ownerName: "Test Owner",
    serverUrl: "https://pettracking2.onrender.com",
    updateInterval: 30000,
    timestamp: new Date().toISOString(),
    message: "Test configuration from server",
    configSentAt: new Date().toISOString(),
    safeZone: {
      center: {
        lat: 10.762622,
        lng: 106.660172,
      },
      radius: 100,
      name: "Test Safe Zone",
      isActive: true,
    },
  };

  console.log(`\n⚙️ Sending test config to ${topics.config}:`);
  console.log(JSON.stringify(configData, null, 2));

  client.publish(
    topics.config,
    JSON.stringify(configData),
    { qos: 1, retain: true },
    (err) => {
      if (err) {
        console.log("❌ Failed to publish config:", err.message);
      } else {
        console.log("✅ Test config published (retained)");
      }
    }
  );
}

// Hàm gửi test message
function sendTestMessage() {
  const testData = {
    test: true,
    message: "Hello ESP32!",
    timestamp: new Date().toISOString(),
    server: "Test Node.js Server",
  };

  console.log(`\n🧪 Sending test message to ${topics.test}:`);
  console.log(JSON.stringify(testData, null, 2));

  client.publish(topics.test, JSON.stringify(testData), { qos: 1 }, (err) => {
    if (err) {
      console.log("❌ Failed to publish test:", err.message);
    } else {
      console.log("✅ Test message sent");
    }
  });
}

// Hàm request location
function requestLocation() {
  const requestData = {
    type: "location_request",
    deviceId: config.deviceId,
    timestamp: new Date().toISOString(),
    message: "Please send your location",
  };

  console.log(`\n📍 Requesting location via ${topics.location}:`);
  console.log(JSON.stringify(requestData, null, 2));

  client.publish(
    topics.location,
    JSON.stringify(requestData),
    { qos: 1 },
    (err) => {
      if (err) {
        console.log("❌ Failed to request location:", err.message);
      } else {
        console.log("✅ Location request sent");
      }
    }
  );
}

// Chạy test trong 30 giây
setTimeout(() => {
  console.log("\n⏰ Test completed after 30 seconds");
  console.log("👋 Disconnecting...");
  client.end();
  process.exit(0);
}, 30000);

// Xử lý Ctrl+C
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  client.end();
  process.exit(0);
});
