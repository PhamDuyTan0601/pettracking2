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

    console.log("ℹ️  Server will PUBLISH to: pets/+/config (not subscribe)");
  }

  async handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      console.log(
        `📨 MQTT Message [${topic}]:`,
        JSON.stringify(payload, null, 2)
      );

      const deviceId = topic.split("/")[1];

      if (topic.includes("/config")) {
        if (
          payload.type === "config_request" ||
          payload.configRequest === true
        ) {
          console.log(`⚙️ Config request from ${deviceId}`);
          await this.handleConfigRequest(deviceId, payload);
          return;
        }

        if (payload.retained === true && payload.message === "RETAINED_TEST") {
          console.log(`📝 Ignoring old retained test message from ${deviceId}`);
          return;
        }
      }

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

        case topic.includes("/config"):
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

      const petData = new PetData({
        petId: device.petId._id,
        latitude: data.latitude,
        longitude: data.longitude,
        speed: data.speed || 0,
        batteryLevel: data.batteryLevel || 100,
        accuracy: data.accuracy || 0,
        timestamp: new Date(),
      });

      await petData.save();

      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${device.petId.name}`);

      console.log(
        `⚙️ AUTO-SENDING NEW FORMAT CONFIG to ${deviceId} (triggered by location)`
      );

      await this.sendConfigToDevice(deviceId);

      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();

      console.log(`✅ New format config sent to ${deviceId} successfully`);
    } catch (error) {
      console.error("❌ Error saving location data:", error);
    }
  }

  async handleStatusUpdate(deviceId, data) {
    try {
      console.log(`🔋 Processing status for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`❌ Device not found in status update: ${deviceId}`);
        return;
      }

      const updateData = {
        lastSeen: new Date(),
        isActive: true,
      };

      if (data.batteryLevel !== undefined)
        updateData.batteryLevel = data.batteryLevel;
      if (data.battery !== undefined) updateData.batteryLevel = data.battery;
      if (data.signalStrength !== undefined)
        updateData.signalStrength = data.signalStrength;
      if (data.rssi !== undefined) updateData.signalStrength = data.rssi;

      await Device.findOneAndUpdate({ deviceId }, updateData);

      console.log(`🔋 Status updated for ${deviceId}`);

      if (
        data.needConfig === true ||
        data.configReceived === false ||
        !device.configSent
      ) {
        console.log(`⚙️ Device ${deviceId} needs config (from status message)`);

        setTimeout(async () => {
          await this.sendConfigToDevice(deviceId);

          device.configSent = true;
          device.lastConfigSent = new Date();
          await device.save();
        }, 1000);
      }
    } catch (error) {
      console.error("❌ Error updating device status:", error);
    }
  }

  async handleConfigRequest(deviceId, data) {
    try {
      console.log(`⚙️ Config request from ${deviceId}:`, data);

      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate("petId", "name safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`❌ Device not found or inactive: ${deviceId}`);
        return;
      }

      console.log(`⚙️ Sending NEW FORMAT config to ${deviceId} as requested`);
      await this.sendConfigToDevice(deviceId);

      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();
    } catch (error) {
      console.error("❌ Error handling config request:", error);
    }
  }

  async handleAlert(deviceId, data) {
    try {
      console.log(`🚨 ALERT from ${deviceId}:`, data);

      const device = await Device.findOne({ deviceId })
        .populate("petId", "name")
        .populate("owner", "name phone");

      if (device && device.owner && device.owner.phone) {
        console.log(`📱 Would send SMS alert to: ${device.owner.phone}`);
      }
    } catch (error) {
      console.error("❌ Error handling alert:", error);
    }
  }

  // 🚨 FIXED: HÀM GỬI CONFIG - NEW FORMAT
  async sendConfigToDevice(deviceId) {
    try {
      console.log(`⚙️ Preparing NEW FORMAT config for device: ${deviceId}`);

      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate("petId", "name safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

      if (!device.petId) {
        console.log(`❌ Pet not found for device: ${deviceId}`);
        return;
      }

      if (!device.owner || !device.owner.phone) {
        console.log(`❌ Owner or phone not found for device: ${deviceId}`);
        return;
      }

      // 🚨 NEW FORMAT - Balanced size and readability
      const config = {
        success: true,
        deviceId: device.deviceId,
        petId: device.petId._id.toString(),
        petName: device.petId.name,
        phoneNumber: device.owner.phone,
      };

      // Thêm owner name nếu có
      if (device.owner.name) {
        config.ownerName = device.owner.name;
      }

      // Thêm safe zone nếu có (chỉ 1 zone đầu tiên)
      if (device.petId.safeZones && device.petId.safeZones.length > 0) {
        const activeZones = device.petId.safeZones.filter(
          (zone) => zone.isActive
        );

        if (activeZones.length > 0) {
          const zone = activeZones.find((z) => z.isPrimary) || activeZones[0];

          config.safeZone = {
            center: {
              lat: parseFloat(zone.center.lat.toFixed(6)),
              lng: parseFloat(zone.center.lng.toFixed(6)),
            },
            radius: Math.round(zone.radius) || 100,
            isActive: true,
          };

          // Thêm name nếu có
          if (zone.name) {
            config.safeZone.name = zone.name.substring(0, 15);
          }
        }
      }

      // Check size
      const jsonStr = JSON.stringify(config);
      const size = jsonStr.length;
      console.log(`📏 New format config size: ${size} bytes`);

      if (size > 300) {
        console.warn(`⚠️ Config might be too large for SIM module`);
        // Cắt bớt nếu quá lớn
        if (config.safeZone && config.safeZone.name) {
          delete config.safeZone.name;
          const newSize = JSON.stringify(config).length;
          console.log(`📏 Reduced to: ${newSize} bytes`);
        }
      }

      console.log(`✅ New format config prepared for ${deviceId}:`);
      console.log(`   Pet: ${config.petName}`);
      console.log(`   Phone: ${config.phoneNumber}`);
      console.log(`   Has Safe Zone: ${!!config.safeZone}`);

      this.publishConfig(deviceId, config);
    } catch (error) {
      console.error("❌ Error sending new format config:", error);
    }
  }

  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot publish");
      return;
    }

    const topic = `pets/${deviceId}/config`;

    console.log(`\n📤 PUBLISHING NEW FORMAT CONFIG:`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Device: ${config.deviceId}`);
    console.log(`   Pet: ${config.petName}`);
    console.log(`   Size: ${JSON.stringify(config).length} bytes`);

    this.client.publish(
      topic,
      JSON.stringify(config),
      { qos: 1, retain: true },
      (err) => {
        if (err) {
          console.error(`❌ Failed to publish new format config:`, err);
        } else {
          console.log(`✅ New format config published to: ${topic}`);
          console.log(`   Retained: YES`);
        }
      }
    );
  }

  async clearRetainedMessages(deviceId) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected");
      return;
    }

    const topics = [
      `pets/${deviceId}/config`,
      `pets/${deviceId}/location`,
      `pets/${deviceId}/status`,
      `pets/${deviceId}/alert`,
    ];

    console.log(`🧹 Clearing retained messages for ${deviceId}...`);

    topics.forEach((topic) => {
      this.client.publish(topic, "", { retain: true, qos: 1 }, (err) => {
        if (err) {
          console.log(`   ❌ Failed to clear ${topic}:`, err.message);
        } else {
          console.log(`   ✅ Cleared retained message from ${topic}`);
        }
      });
    });
  }

  getConnectionStatus() {
    return this.isConnected;
  }

  async manualPublishConfig(deviceId) {
    console.log(`🔧 Manual new format config publish for: ${deviceId}`);
    await this.sendConfigToDevice(deviceId);
  }
}

module.exports = new MQTTService();
