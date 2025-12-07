const mqtt = require("mqtt");

console.log("🤖 ESP32 SEND & RECEIVE TEST");
console.log("=".repeat(60));

// ================================
// 🧪 CONFIG - DÙNG SERVER CỦA BẠN
// ================================
const CONFIG = {
  // MQTT Broker của bạn
  mqttBroker: "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
  mqttUsername: "duytan",
  mqttPassword: "123456",

  // Device ID của ESP32
  deviceId: "ESP32_68C2470B65F4",
};

// Biến lưu kết quả
const testResults = {
  mqttConnected: false,
  subscribed: false,
  messagesSent: 0,
  messagesReceived: 0,
  configReceived: false,
  configData: null,
};

// ================================
// 🚀 KẾT NỐI MQTT
// ================================
console.log("🔗 Connecting to MQTT...");
console.log(`   Broker: ${CONFIG.mqttBroker}`);
console.log(`   Username: ${CONFIG.mqttUsername}`);
console.log(`   Device ID: ${CONFIG.deviceId}`);
console.log("=".repeat(60));

const client = mqtt.connect(CONFIG.mqttBroker, {
  username: CONFIG.mqttUsername,
  password: CONFIG.mqttPassword,
  clientId: `esp32_test_${CONFIG.deviceId}_${Date.now()}`,
  clean: true,
  reconnectPeriod: 1000,
  connectTimeout: 10000,
});

// ================================
// 📡 XỬ LÝ SỰ KIỆN
// ================================
client.on("connect", () => {
  console.log("\n✅ CONNECTED TO MQTT BROKER!");
  testResults.mqttConnected = true;

  // Subscribe to config topic để nhận config từ server
  const configTopic = `pets/${CONFIG.deviceId}/config`;
  client.subscribe(configTopic, { qos: 1 }, (err) => {
    if (err) {
      console.log(`❌ Failed to subscribe to ${configTopic}:`, err.message);
    } else {
      console.log(`✅ Subscribed to: ${configTopic}`);
      testResults.subscribed = true;
    }
  });

  // Bắt đầu test sequence
  startTestSequence();
});

client.on("message", (topic, message) => {
  console.log(`\n📨 RECEIVED MESSAGE:`);
  console.log(`   Topic: ${topic}`);
  console.log(`   Time: ${new Date().toLocaleTimeString()}`);
  console.log(`   Length: ${message.length} bytes`);

  testResults.messagesReceived++;

  try {
    const data = JSON.parse(message.toString());

    // Hiển thị toàn bộ message
    console.log("\n📦 FULL MESSAGE CONTENT:");
    console.log(JSON.stringify(data, null, 2));

    // Phân tích loại message
    if (topic.includes("/config")) {
      console.log("\n🎯 CONFIG MESSAGE ANALYSIS:");

      if (data._source === "server" || data.success === true) {
        console.log("✅ ✅ ✅ THIS IS A REAL CONFIG FROM SERVER! ✅ ✅ ✅");
        testResults.configReceived = true;
        testResults.configData = data;

        console.log("\n📋 CONFIG SUMMARY:");
        console.log("=".repeat(40));
        console.log(`Pet Name: ${data.petName || "Not specified"}`);
        console.log(`Phone: ${data.phoneNumber || "Not specified"}`);
        console.log(`Owner: ${data.ownerName || "Not specified"}`);
        console.log(`Update Interval: ${data.updateInterval || 30000}ms`);
        console.log(`Server URL: ${data.serverUrl || "Not specified"}`);

        if (data.safeZone) {
          console.log(`Safe Zone: YES`);
          console.log(
            `   Center: ${data.safeZone.center.lat}, ${data.safeZone.center.lng}`
          );
          console.log(`   Radius: ${data.safeZone.radius}m`);
          console.log(`   Name: ${data.safeZone.name}`);
        } else {
          console.log(`Safe Zone: NO`);
        }

        console.log(`Timestamp: ${data.timestamp}`);
        console.log("=".repeat(40));
      } else if (data.retained === true) {
        console.log("⚠️  RETAINED MESSAGE (old test message):");
        console.log(`   Message: ${data.message || "No message"}`);
      } else if (data.type === "config_request") {
        console.log("📤 Config request echo (sent by this test)");
      } else {
        console.log("📝 Other config message");
      }
    }
  } catch (e) {
    console.log("❌ Cannot parse JSON, raw message:");
    console.log(message.toString());
  }
});

client.on("error", (err) => {
  console.log("❌ MQTT Error:", err.message);
});

// ================================
// 🧪 TEST SEQUENCE - MÔ PHỎNG ESP32
// ================================
function startTestSequence() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 STARTING ESP32 TEST SEQUENCE");
  console.log("=".repeat(60));

  // Delay 2 giây để đảm bảo subscription hoạt động
  setTimeout(() => {
    // TEST 1: ESP32 gửi boot message
    console.log("\n🧪 TEST 1: ESP32 BOOT MESSAGE");
    console.log("=".repeat(40));

    const bootMessage = {
      deviceId: CONFIG.deviceId,
      type: "boot",
      message: "ESP32 booted up",
      firmwareVersion: "1.0.0",
      freeHeap: 250000,
      timestamp: new Date().toISOString(),
      needConfig: true, // Yêu cầu config
    };

    const bootTopic = `pets/${CONFIG.deviceId}/status`;

    console.log("📤 ESP32 sending boot message:");
    console.log(`   Topic: ${bootTopic}`);
    console.log("   Data:", JSON.stringify(bootMessage, null, 2));

    client.publish(
      bootTopic,
      JSON.stringify(bootMessage),
      { qos: 1 },
      (err) => {
        if (err) {
          console.log("❌ Publish failed:", err.message);
        } else {
          console.log("✅ Boot message sent");
          testResults.messagesSent++;
        }
      }
    );
  }, 2000);

  // TEST 2: ESP32 gửi config request
  setTimeout(() => {
    console.log("\n🧪 TEST 2: CONFIG REQUEST");
    console.log("=".repeat(40));

    const configRequest = {
      deviceId: CONFIG.deviceId,
      type: "config_request",
      message: "ESP32 requesting configuration",
      timestamp: new Date().toISOString(),
      urgent: true,
      requestId: `req_${Date.now()}`,
    };

    const configTopic = `pets/${CONFIG.deviceId}/config`;

    console.log("📤 ESP32 sending config request:");
    console.log(`   Topic: ${configTopic}`);
    console.log("   Data:", JSON.stringify(configRequest, null, 2));

    client.publish(
      configTopic,
      JSON.stringify(configRequest),
      { qos: 1 },
      (err) => {
        if (err) {
          console.log("❌ Publish failed:", err.message);
        } else {
          console.log("✅ Config request sent");
          testResults.messagesSent++;
        }
      }
    );
  }, 4000);

  // TEST 3: ESP32 gửi location data (triggers auto-config)
  setTimeout(() => {
    console.log("\n🧪 TEST 3: LOCATION DATA");
    console.log("=".repeat(40));

    const locationData = {
      deviceId: CONFIG.deviceId,
      type: "location",
      latitude: 10.762622,
      longitude: 106.660172,
      speed: 0.5,
      batteryLevel: 85,
      accuracy: 12,
      needConfig: true, // Yêu cầu config
      timestamp: new Date().toISOString(),
    };

    const locationTopic = `pets/${CONFIG.deviceId}/location`;

    console.log("📤 ESP32 sending location data:");
    console.log(`   Topic: ${locationTopic}`);
    console.log("   Data:", JSON.stringify(locationData, null, 2));

    client.publish(
      locationTopic,
      JSON.stringify(locationData),
      { qos: 1 },
      (err) => {
        if (err) {
          console.log("❌ Publish failed:", err.message);
        } else {
          console.log("✅ Location data sent");
          testResults.messagesSent++;

          console.log("\n💡 Server should auto-send config now");
          console.log("   (if device is registered and active)");
        }
      }
    );
  }, 6000);

  // TEST 4: ESP32 gửi status update
  setTimeout(() => {
    console.log("\n🧪 TEST 4: STATUS UPDATE");
    console.log("=".repeat(40));

    const statusData = {
      deviceId: CONFIG.deviceId,
      type: "status",
      batteryLevel: 82,
      signalStrength: -65,
      freeHeap: 245000,
      uptime: 60,
      needConfig: true, // Vẫn yêu cầu config nếu chưa có
      timestamp: new Date().toISOString(),
    };

    const statusTopic = `pets/${CONFIG.deviceId}/status`;

    console.log("📤 ESP32 sending status update:");
    console.log(`   Topic: ${statusTopic}`);
    console.log("   Data:", JSON.stringify(statusData, null, 2));

    client.publish(
      statusTopic,
      JSON.stringify(statusData),
      { qos: 1 },
      (err) => {
        if (err) {
          console.log("❌ Publish failed:", err.message);
        } else {
          console.log("✅ Status update sent");
          testResults.messagesSent++;
        }
      }
    );
  }, 8000);

  // TEST 5: ESP32 gửi test alert
  setTimeout(() => {
    console.log("\n🧪 TEST 5: TEST ALERT");
    console.log("=".repeat(40));

    const alertData = {
      deviceId: CONFIG.deviceId,
      type: "test_alert",
      message: "This is a test alert from ESP32",
      severity: "low",
      timestamp: new Date().toISOString(),
    };

    const alertTopic = `pets/${CONFIG.deviceId}/alert`;

    console.log("📤 ESP32 sending test alert:");
    console.log(`   Topic: ${alertTopic}`);
    console.log("   Data:", JSON.stringify(alertData, null, 2));

    client.publish(alertTopic, JSON.stringify(alertData), { qos: 1 }, (err) => {
      if (err) {
        console.log("❌ Publish failed:", err.message);
      } else {
        console.log("✅ Test alert sent");
        testResults.messagesSent++;
      }
    });
  }, 10000);

  // Hiển thị kết quả sau 15 giây
  setTimeout(() => {
    showTestResults();
  }, 15000);
}

// ================================
// 📊 HIỂN THỊ KẾT QUẢ
// ================================
function showTestResults() {
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST RESULTS SUMMARY");
  console.log("=".repeat(60));

  console.log(
    `✅ MQTT Connection: ${testResults.mqttConnected ? "SUCCESS" : "FAILED"}`
  );
  console.log(
    `✅ Topic Subscription: ${testResults.subscribed ? "SUCCESS" : "FAILED"}`
  );
  console.log(`📤 Messages Sent: ${testResults.messagesSent}/5`);
  console.log(`📨 Messages Received: ${testResults.messagesReceived}`);
  console.log(
    `🎯 Config Received: ${testResults.configReceived ? "YES ✅" : "NO ❌"}`
  );

  if (testResults.configReceived && testResults.configData) {
    console.log("\n🎉 CONFIG RECEIVED SUCCESSFULLY!");
    console.log("ESP32 sẽ nhận được các thông tin sau:");
    console.log("=".repeat(40));
    console.log(`📱 Pet Name: ${testResults.configData.petName}`);
    console.log(`📞 Phone: ${testResults.configData.phoneNumber}`);
    console.log(
      `⏱️ Update Interval: ${testResults.configData.updateInterval}ms`
    );
    console.log(
      `🛡️ Safe Zone: ${
        testResults.configData.safeZone ? "Configured" : "Not configured"
      }`
    );
    console.log(`🌐 Server: ${testResults.configData.serverUrl}`);
    console.log("=".repeat(40));

    console.log("\n✅ ESP32 sẽ làm gì với config này:");
    console.log("   1. Lưu phone number để gửi SMS");
    console.log("   2. Lưu safe zone để kiểm tra vùng an toàn");
    console.log(
      "   3. Gửi location mỗi",
      testResults.configData.updateInterval,
      "ms"
    );
    console.log("   4. Kết nối đến server:", testResults.configData.serverUrl);
  } else {
    console.log("\n❌ CONFIG NOT RECEIVED");
    console.log("Nguyên nhân có thể:");
    console.log("   1. Device chưa được đăng ký trên server");
    console.log("   2. Server không auto-send config");
    console.log("   3. MQTT topic không đúng");
    console.log("   4. Server offline hoặc có lỗi");

    console.log("\n💡 Giải pháp:");
    console.log("   1. Kiểm tra device đã đăng ký chưa");
    console.log("   2. Trigger config manual từ web:");
    console.log(
      `      https://pettracking2.onrender.com/debug/send-config/${CONFIG.deviceId}`
    );
    console.log("   3. Kiểm tra server logs");
  }

  console.log("\n" + "=".repeat(60));
  console.log("🔌 Disconnecting...");
  client.end();
  process.exit(0);
}

// ================================
// ⏰ AUTO TIMEOUT (20 giây)
// ================================
setTimeout(() => {
  console.log("\n⏰ Timeout reached, showing results...");
  showTestResults();
}, 20000);
