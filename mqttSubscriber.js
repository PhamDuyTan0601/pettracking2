const mqtt = require("mqtt");
const mongoose = require("mongoose");
const PetData = require("./models/petData");
const Device = require("./models/device");

class MQTTService {
  constructor() {
    this.config = {
      brokerUrl:
        process.env.MQTT_BROKER_URL ||
        "mqtt://u799c202.ala.dedicated.aws.emqxcloud.com:1883",

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
        // KHÔNG subscribe config vì server publish topic này
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

    console.log("ℹ️  Server will PUBLISH to: pets/+/config (not subscribe)");
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
          console.log("📝 Unknown topic (ignoring):", topic);
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

      // ❗ Chỉ dùng thời gian server → tránh hoàn toàn lỗi Invalid Date
      const petData = new PetData({
        petId: device.petId._id,
        latitude: data.latitude,
        longitude: data.longitude,
        speed: data.speed || 0,
        batteryLevel: data.batteryLevel,
        accuracy: data.accuracy || 0,
        timestamp: new Date(), // 🔥 FIX LỖI: luôn dùng timestamp server
      });

      await petData.save();

      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${device.petId.name}`);

      // 🔥 AUTO-SEND CONFIG khi nhận location đầu tiên
      if (!device.configSent) {
        console.log(`⚙️ First location from ${deviceId} - auto-sending config`);
        await this.sendConfigToDevice(deviceId);
        device.configSent = true;
        device.lastConfigSent = new Date();
        await device.save();
      }
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

      // Tìm device để lấy thông tin pet và owner
      const device = await Device.findOne({ deviceId })
        .populate("petId", "name")
        .populate("owner", "name phone");

      if (device && device.owner && device.owner.phone) {
        console.log(`📱 Would send SMS alert to: ${device.owner.phone}`);
        // Ở đây bạn có thể tích hợp SMS service
      }
    } catch (error) {
      console.error("❌ Error handling alert:", error);
    }
  }

  async sendConfigToDevice(deviceId) {
    try {
      console.log(`⚙️ Preparing config for device: ${deviceId}`);

      // 🚨 FIX: Kiểm tra và sửa deviceId nếu sai
      deviceId = this.validateDeviceId(deviceId);

      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate("petId", "name species breed safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

      // Prepare config
      let safeZoneInfo = null;
      if (device.petId.safeZones && device.petId.safeZones.length > 0) {
        const activeZone =
          device.petId.safeZones.find((zone) => zone.isActive) ||
          device.petId.safeZones[0];

        if (activeZone) {
          safeZoneInfo = {
            center: {
              lat: activeZone.center.lat,
              lng: activeZone.center.lng,
            },
            radius: activeZone.radius,
            name: activeZone.name,
            isActive: activeZone.isActive,
          };
        }
      }

      const config = {
        success: true,
        deviceId: device.deviceId, // Đảm bảo deviceId đúng
        petId: device.petId._id,
        petName: device.petId.name,
        phoneNumber: device.owner.phone,
        ownerName: device.owner.name,
        serverUrl:
          process.env.SERVER_URL || "https://pettracking2.onrender.com",
        updateInterval: 30000,
        timestamp: new Date().toISOString(),
        message: "Configuration from Pet Tracker Server",
        _source: "server", // Thêm identifier để tránh loop
      };

      if (safeZoneInfo) {
        config.safeZone = safeZoneInfo;
        console.log(
          `📍 Safe zone included: ${safeZoneInfo.name} (${safeZoneInfo.radius}m)`
        );
      } else {
        console.log(`ℹ️  No safe zone configured for ${device.petId.name}`);
      }

      // Publish config
      this.publishConfig(deviceId, config);
    } catch (error) {
      console.error("❌ Error sending config:", error);
    }
  }

  validateDeviceId(deviceId) {
    // 🚨 FIX: Nếu deviceId sai, tự động sửa
    if (deviceId === "ESP32_EC8A75B865E4") {
      console.log(`⚠️  WARNING: Wrong deviceId detected: ${deviceId}`);
      console.log(`   Auto-correcting to: ESP32_68C2470B65F4`);
      return "ESP32_68C2470B65F4";
    }
    return deviceId;
  }

  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot publish");
      return;
    }

    // 🚨 FIX: Đảm bảo deviceId đúng
    deviceId = this.validateDeviceId(deviceId);

    // Đảm bảo config.deviceId khớp
    config.deviceId = deviceId;

    const topic = `pets/${deviceId}/config`;

    console.log(`\n🔍 DEBUG PUBLISH CONFIG:`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Config deviceId: ${config.deviceId}`);

    if (topic.includes("ESP32_EC8A75B865E4")) {
      console.log(`❌❌❌ CRITICAL: Trying to publish to WRONG device!`);
      console.log(`   Topic contains wrong device ID!`);
      return;
    }

    this.client.publish(
      topic,
      JSON.stringify(config),
      { qos: 1, retain: true },
      (err) => {
        if (err) {
          console.error(`❌ Failed to publish config:`, err);
        } else {
          console.log(`✅ Published config to: ${topic}`);
          console.log(`   Pet: ${config.petName}`);
          console.log(`   Phone: ${config.phoneNumber}`);
          if (config.safeZone) {
            console.log(`   Safe Zone: ${config.safeZone.name}`);
          }
        }
      }
    );
  }

  getConnectionStatus() {
    return this.isConnected;
  }

  // Helper để manual publish config
  async manualPublishConfig(deviceId) {
    console.log(`🔧 Manual config publish for: ${deviceId}`);
    await this.sendConfigToDevice(deviceId);
  }
}

module.exports = new MQTTService();
