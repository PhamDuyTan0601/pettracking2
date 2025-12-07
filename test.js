// testMqttToESP32.js
const mqtt = require("mqtt");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const deviceId = "ESP32_68C2470B65F4";

console.log("🚀 MQTT to ESP32 Test");
console.log("=====================\n");
console.log("1. Start ESP32 and wait for it to connect");
console.log("2. Check Serial Monitor for MQTT connection");
console.log("3. Press Enter here to send test message\n");

const client = mqtt.connect(
  "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",
  {
    username: "duytan",
    password: "123456",
    clientId: `manual_test_${Date.now()}`,
  }
);

client.on("connect", () => {
  console.log("✅ Connected to MQTT broker");
  console.log(`📡 Ready to publish to: pets/${deviceId}/config\n`);

  rl.question("Press Enter when ESP32 is ready...", () => {
    sendTestMessage();
  });
});

function sendTestMessage() {
  const message = {
    success: true,
    deviceId: deviceId,
    petName: "Test Bobby",
    phoneNumber: "+84123456789",
    timestamp: new Date().toISOString(),
    message: "HELLO FROM NODE.JS TEST",
    testNumber: 1,
  };

  const topic = `pets/${deviceId}/config`;

  console.log(`\n📤 Publishing to: ${topic}`);
  console.log("Message:", JSON.stringify(message, null, 2));

  // Send 3 times to be sure
  let count = 0;
  const send = () => {
    client.publish(
      topic,
      JSON.stringify({ ...message, testNumber: count + 1 }),
      { qos: 1 },
      (err) => {
        if (err) {
          console.error(`❌ Send ${count + 1} failed:`, err);
        } else {
          count++;
          console.log(`✅ Message ${count} sent`);
        }

        if (count < 3) {
          setTimeout(send, 1000);
        } else {
          console.log("\n🎯 3 messages sent!");
          console.log("\n🔍 Check ESP32 Serial Monitor for:");
          console.log('- "[MQTT] Checking for messages..."');
          console.log('- "[MQTT] Message pending!"');
          console.log('- "[MQTT] JSON found:"');

          rl.close();
          client.end();
          process.exit(0);
        }
      }
    );
  };

  send();
}

client.on("error", (err) => {
  console.error("❌ MQTT error:", err);
  rl.close();
  process.exit(1);
});
