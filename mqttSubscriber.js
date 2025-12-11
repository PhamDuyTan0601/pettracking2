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
      console.error("MQTT Connection failed:", error);
    }
  }

  setupEventHandlers() {
    this.client.on("connect", () => {
      console.log("Connected to EMQX Cloud Broker!");
      this.isConnected = true;
      this.subscribeToTopics();
    });

    this.client.on("message", this.handleMessage.bind(this));

    this.client.on("error", (error) => {
      console.error("MQTT Error:", error);
      this.isConnected = false;
    });

    this.client.on("close", () => {
      console.log("🔌 MQTT Connection closed");
      this.isConnected = false;
    });

    this.client.on("reconnect", () => {
      console.log("MQTT Reconnecting...");
    });

    this.client.on("offline", () => {
      console.log("MQTT Offline");
      this.isConnected = false;
    });
  }

  subscribeToTopics() {
    const topics = Object.values(this.config.topics);
    topics.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`Subscribed to: ${topic}`);
        }
      });
    });

    console.log("Server will PUBLISH to: pets/+/config (not subscribe)");
  }

  async handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      console.log(
        ` MQTT Message [${topic}]:`,
        JSON.stringify(payload, null, 2)
      );

      const deviceId = topic.split("/")[1];

      if (topic.includes("/config")) {
        if (
          payload.type === "config_request" ||
          payload.configRequest === true
        ) {
          console.log(`Config request from ${deviceId}`);
          await this.handleConfigRequest(deviceId, payload);
          return;
        }

        if (payload.retained === true && payload.message === "RETAINED_TEST") {
          console.log(`Ignoring old retained test message from ${deviceId}`);
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
          console.log("Unknown topic (ignoring):", topic);
      }
    } catch (error) {
      console.error("Error processing MQTT message:", error);
    }
  }

  async handleLocationData(deviceId, data) {
    try {
      console.log(`Processing location for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId }).populate("petId");
      if (!device) {
        console.log(`Device not found: ${deviceId}`);
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

      console.log(`Location saved for ${deviceId} → ${device.petId.name}`);

      console.log(`AUTO-SENDING CONFIG to ${deviceId} (triggered by location)`);

      await this.sendConfigToDevice(deviceId);

      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();

      console.log(`Config sent to ${deviceId} successfully`);
    } catch (error) {
      console.error("Error saving location data:", error);
    }
  }

  async handleStatusUpdate(deviceId, data) {
    try {
      console.log(`Processing status for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`Device not found in status update: ${deviceId}`);
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

      console.log(`Status updated for ${deviceId}`);

      if (
        data.needConfig === true ||
        data.configReceived === false ||
        !device.configSent
      ) {
        console.log(`Device ${deviceId} needs config (from status message)`);

        setTimeout(async () => {
          await this.sendConfigToDevice(deviceId);

          device.configSent = true;
          device.lastConfigSent = new Date();
          await device.save();
        }, 1000);
      }
    } catch (error) {
      console.error("Error updating device status:", error);
    }
  }

  async handleConfigRequest(deviceId, data) {
    try {
      console.log(`Config request from ${deviceId}:`, data);

      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate("petId", "name species breed safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`Device not found or inactive: ${deviceId}`);
        return;
      }

      console.log(`Sending config to ${deviceId} as requested`);
      await this.sendConfigToDevice(deviceId);

      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();
    } catch (error) {
      console.error("Error handling config request:", error);
    }
  }

  async handleAlert(deviceId, data) {
    try {
      console.log(`ALERT from ${deviceId}:`, data);

      const device = await Device.findOne({ deviceId })
        .populate("petId", "name")
        .populate("owner", "name phone");

      if (device && device.owner && device.owner.phone) {
        console.log(`Would send SMS alert to: ${device.owner.phone}`);
      }
    } catch (error) {
      console.error("Error handling alert:", error);
    }
  }

  //   GIỚI HẠN 5 SAFE ZONES VÀ MINIMAL CONFIG
  async sendConfigToDevice(deviceId) {
    try {
      console.log(` Preparing config for device: ${deviceId}`);

      const device = await Device.findOne({
        deviceId,
        isActive: true,
      })
        .populate("petId", "name species breed safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`Device not found: ${deviceId}`);
        return;
      }

      if (!device.petId) {
        console.log(`Pet not found for device: ${deviceId}`);
        return;
      }

      if (!device.owner || !device.owner.phone) {
        console.log(`Owner or phone not found for device: ${deviceId}`);
        return;
      }

      //  GIỚI HẠN CHỈ 5 SAFE ZONES MỚI NHẤT
      let safeZonesInfo = [];
      const MAX_ZONES_FOR_ESP32 = 5;

      if (device.petId.safeZones && device.petId.safeZones.length > 0) {
        const activeZones = device.petId.safeZones.filter(
          (zone) => zone.isActive
        );

        // SORT BY CREATION DATE (NEWEST FIRST)
        const sortedZones = activeZones.sort((a, b) => {
          const dateA = a.createdAt || a._id.getTimestamp();
          const dateB = b.createdAt || b._id.getTimestamp();
          return new Date(dateB) - new Date(dateA);
        });

        // GIỚI HẠN CHỈ 5 ZONES
        const limitedZones = sortedZones.slice(0, MAX_ZONES_FOR_ESP32);

        if (limitedZones.length > 0) {
          safeZonesInfo = limitedZones.map((zone) => ({
            lat: zone.center.lat,
            lng: zone.center.lng,
            radius: zone.radius || 100,
          }));
        }
      }

      const totalZonesInDB = device.petId.safeZones?.length || 0;
      const activeZonesCount =
        device.petId.safeZones?.filter((z) => z.isActive).length || 0;

      console.log(
        `Found ${safeZonesInfo.length} safe zones for ${deviceId} (out of ${activeZonesCount} active, ${totalZonesInDB} total)`
      );

      // MINIMAL CONFIG - CHỈ CÁC TRƯỜNG ESP32 CẦN
      const config = {
        success: true,
        petId: device.petId._id.toString(),
        petName: device.petId.name,
        phoneNumber: device.owner.phone,
        maxZones: MAX_ZONES_FOR_ESP32,
        timestamp: new Date().toISOString(),
      };

      if (safeZonesInfo.length > 0) {
        config.safeZones = safeZonesInfo;
        safeZonesInfo.forEach((zone, index) => {
          console.log(`   Zone ${index + 1}: ${zone.radius}m`);
        });
      }

      // Thêm warning nếu có quá nhiều zones
      if (totalZonesInDB > MAX_ZONES_FOR_ESP32) {
        config.warning = `Only ${MAX_ZONES_FOR_ESP32} most recent zones shown (${totalZonesInDB} total)`;
      }

      console.log(`Config prepared for ${deviceId}:`);
      console.log(`   Pet: ${config.petName}`);
      console.log(`   Phone: ${config.phoneNumber}`);
      console.log(`   Safe Zones: ${safeZonesInfo.length}`);

      this.publishConfig(deviceId, config);
    } catch (error) {
      console.error("Error sending config:", error);
    }
  }

  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("MQTT not connected, cannot publish");
      return;
    }

    const topic = `pets/${deviceId}/config`;

    console.log(`\nPUBLISHING CONFIG:`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Device: ${deviceId}`);
    console.log(`   Pet: ${config.petName}`);
    console.log(`   Safe Zones: ${config.safeZones?.length || 0}`);
    console.log(`   Size: ${JSON.stringify(config).length} bytes`);

    //  KIỂM TRA KÍCH THƯỚC MESSAGE
    const messageSize = JSON.stringify(config).length;
    if (messageSize > 5000) {
      // 5KB limit
      console.warn(`Config message is large: ${messageSize} bytes`);

      // Nếu quá lớn, chỉ gửi essential data
      const minimalConfig = {
        success: config.success,
        phoneNumber: config.phoneNumber,
        safeZones: config.safeZones || [],
        warning: "Minimal config due to size constraints",
      };

      this.client.publish(
        topic,
        JSON.stringify(minimalConfig),
        { qos: 1, retain: true },
        (err) => {
          if (err) {
            console.error(`Failed to publish minimal config:`, err);
          } else {
            console.log(`Minimal config published to: ${topic}`);
          }
        }
      );
    } else {
      this.client.publish(
        topic,
        JSON.stringify(config),
        { qos: 1, retain: true },
        (err) => {
          if (err) {
            console.error(`Failed to publish config:`, err);
          } else {
            console.log(`Config published to: ${topic}`);
            console.log(`   Retained: YES`);
          }
        }
      );
    }
  }

  async clearRetainedMessages(deviceId) {
    if (!this.isConnected) {
      console.log("MQTT not connected");
      return;
    }

    const topics = [
      `pets/${deviceId}/config`,
      `pets/${deviceId}/location`,
      `pets/${deviceId}/status`,
      `pets/${deviceId}/alert`,
    ];

    console.log(`Clearing retained messages for ${deviceId}...`);

    topics.forEach((topic) => {
      this.client.publish(topic, "", { retain: true, qos: 1 }, (err) => {
        if (err) {
          console.log(`  Failed to clear ${topic}:`, err.message);
        } else {
          console.log(`  Cleared retained message from ${topic}`);
        }
      });
    });
  }

  getConnectionStatus() {
    return this.isConnected;
  }

  async manualPublishConfig(deviceId) {
    console.log(`Manual config publish for: ${deviceId}`);
    await this.sendConfigToDevice(deviceId);
  }
}

module.exports = new MQTTService();
