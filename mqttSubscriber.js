// mqttSubscriber.js
const mqtt = require("mqtt");
const mongoose = require("mongoose");
const PetData = require("./models/petData");
const Device = require("./models/device");

class MQTTService {
  constructor() {
    this.config = {
      // ✅ EMQX Cloud URL của bạn
      brokerUrl:
        process.env.MQTT_BROKER_URL ||
        "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",

      // ✅ CREDENTIALS BẠN VỪA TẠO
      username: process.env.MQTT_USERNAME || "duytan",
      password: process.env.MQTT_PASSWORD || "123456",

      clientId: `pet_tracker_server_${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,

      topics: {
        location: "pets/+/location",
        status: "pets/+/status",
        alert: "pets/+/alert",
        config: "pets/+/config",
      },
    };

    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      console.log("🔗 Connecting to EMQX Cloud...");
      console.log("📝 Broker:", this.config.brokerUrl);
      console.log("👤 Username:", this.config.username);

      this.client = mqtt.connect(this.config.brokerUrl, {
        username: this.config.username,
        password: this.config.password,
        clientId: this.config.clientId,
        clean: this.config.clean,
        reconnectPeriod: this.config.reconnectPeriod,
        connectTimeout: this.config.connectTimeout,
      });

      this.setupEventHandlers();
    } catch (error) {
      console.error("❌ MQTT Connection failed:", error);
    }
  }

  setupEventHandlers() {
    this.client.on("connect", () => {
      console.log("✅ Connected to EMQX Cloud Broker!");
      this.isConnected = true;
      this.subscribeToTopics();
    });

    this.client.on("message", this.handleMessage.bind(this));

    this.client.on("error", (error) => {
      console.error("❌ MQTT Error:", error);
      this.isConnected = false;
    });

    this.client.on("close", () => {
      console.log("🔌 MQTT Connection closed");
      this.isConnected = false;
    });

    this.client.on("reconnect", () => {
      console.log("🔄 MQTT Reconnecting...");
    });

    this.client.on("offline", () => {
      console.log("📴 MQTT Offline");
      this.isConnected = false;
    });
  }

  subscribeToTopics() {
    const topics = Object.values(this.config.topics);
    topics.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`✅ Subscribed to: ${topic}`);
        }
      });
    });
  }

  async handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      console.log(`📨 MQTT Message [${topic}]:`, payload);

      const deviceId = topic.split("/")[1];

      switch (true) {
        case topic.includes("/location"):
          await this.handleLocationData(deviceId, payload);
          break;

        case topic.includes("/status"):
          await this.handleStatusUpdate(deviceId, payload);
          break;

        case topic.includes("/alert"):
          await this.handleAlert(deviceId, payload);
          break;

        default:
          console.log("📝 Unknown topic:", topic);
      }
    } catch (error) {
      console.error("❌ Error processing MQTT message:", error);
    }
  }

  async handleLocationData(deviceId, data) {
    try {
      console.log(`📍 Processing location for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId }).populate("petId");
      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

      const petData = new PetData({
        petId: device.petId._id,
        latitude: data.latitude,
        longitude: data.longitude,
        speed: data.speed || 0,
        batteryLevel: data.batteryLevel,
        accuracy: data.accuracy || 0,
        timestamp: new Date(data.timestamp || Date.now()),
      });

      await petData.save();

      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${device.petId.name}`);
    } catch (error) {
      console.error("❌ Error saving location data:", error);
    }
  }

  async handleStatusUpdate(deviceId, data) {
    try {
      await Device.findOneAndUpdate(
        { deviceId },
        {
          lastSeen: new Date(),
          batteryLevel: data.batteryLevel,
          signalStrength: data.signalStrength,
          isActive: true,
        }
      );
      console.log(`🔋 Status updated for ${deviceId}`);
    } catch (error) {
      console.error("❌ Error updating device status:", error);
    }
  }

  async handleAlert(deviceId, data) {
    try {
      console.log(`🚨 ALERT from ${deviceId}:`, data);
      // Implement SMS/Email alerts here later
    } catch (error) {
      console.error("❌ Error handling alert:", error);
    }
  }

  // Method để publish messages đến ESP32
  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot publish");
      return;
    }

    const topic = `pets/${deviceId}/config`;
    this.client.publish(topic, JSON.stringify(config), { qos: 1 });
    console.log(`⚙️ Config sent to ${deviceId}`);
  }

  getConnectionStatus() {
    return this.isConnected;
  }
}

module.exports = new MQTTService();
