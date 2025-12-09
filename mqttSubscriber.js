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

      // Xử lý config request
      if (topic.includes("/config")) {
        if (
          payload.type === "config_request" ||
          payload.configRequest === true
        ) {
          console.log(`⚙️ Config request from ${deviceId}`);
          await this.handleConfigRequest(deviceId, payload);
          return;
        }

        // Bỏ qua retained test message
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
          // Đã xử lý ở trên
          break;

        default:
          console.log("📝 Unknown topic (ignoring):", topic);
      }
    } catch (error) {
      console.error("❌ Error processing MQTT message:", error);
    }
  }

  // 🔥 HÀM MỚI: Lưu vị trí đầu tiên vào device
  async captureFirstLocation(device, latitude, longitude) {
    try {
      if (!device.firstLocationCaptured) {
        console.log(`🎯 LƯU VỊ TRÍ ĐẦU TIÊN cho device: ${device.deviceId}`);

        device.firstLocationCaptured = true;
        device.firstLocationLat = latitude;
        device.firstLocationLng = longitude;
        device.firstLocationTimestamp = new Date();

        await device.save();

        console.log(`✅ Đã lưu vị trí đầu tiên: ${latitude}, ${longitude}`);
        console.log(
          `   Thời gian: ${device.firstLocationTimestamp.toLocaleTimeString(
            "vi-VN"
          )}`
        );

        return true;
      }
      return false;
    } catch (error) {
      console.error("❌ Lỗi khi lưu vị trí đầu tiên:", error);
      return false;
    }
  }

  // 🔥 HÀM MỚI: Tạo safe zone từ vị trí đầu tiên đã lưu
  async createSafeZoneFromFirstLocation(device) {
    try {
      if (
        !device.firstLocationCaptured ||
        !device.firstLocationLat ||
        !device.firstLocationLng
      ) {
        console.log(`❌ Device ${device.deviceId} chưa có vị trí đầu tiên`);
        return null;
      }

      const Pet = require("./models/pet");
      const pet = await Pet.findById(device.petId);

      if (!pet) {
        console.log(`❌ Pet not found: ${device.petId}`);
        return null;
      }

      // Kiểm tra đã có safe zone autoCreated chưa
      const hasAutoCreatedZone =
        pet.safeZones &&
        pet.safeZones.some((zone) => zone.autoCreated === true);

      if (hasAutoCreatedZone) {
        console.log(`ℹ️ Pet ${pet.name} đã có safe zone tự động tạo`);
        return null;
      }

      // Tạo safe zone từ vị trí đầu tiên
      const safeZoneData = {
        name: "Vị trí an toàn chính",
        center: {
          lat: device.firstLocationLat,
          lng: device.firstLocationLng,
        },
        radius: 100,
        isActive: true,
        isPrimary: true,
        autoCreated: true,
        notes: `Tự động tạo từ vị trí đầu tiên (${device.firstLocationTimestamp.toLocaleString(
          "vi-VN"
        )})`,
        createdAt: new Date(),
      };

      if (!pet.safeZones) pet.safeZones = [];
      pet.safeZones.push(safeZoneData);
      await pet.save();

      console.log(`✅ Đã tạo safe zone từ vị trí đầu tiên:`);
      console.log(`   Pet: ${pet.name}`);
      console.log(
        `   Vị trí: ${device.firstLocationLat}, ${device.firstLocationLng}`
      );
      console.log(
        `   Thời gian vị trí đầu: ${device.firstLocationTimestamp.toLocaleTimeString(
          "vi-VN"
        )}`
      );
      console.log(`   Bán kính: 100m`);

      return safeZoneData;
    } catch (error) {
      console.error("❌ Lỗi tạo safe zone từ vị trí đầu tiên:", error);
      return null;
    }
  }

  // 🔥 SỬA HÀM: Xử lý location data
  async handleLocationData(deviceId, data) {
    try {
      console.log(`📍 Processing location for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId }).populate("petId");
      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

      // 🆕 QUAN TRỌNG: Lưu vị trí đầu tiên
      const isFirstLocation = await this.captureFirstLocation(
        device,
        data.latitude,
        data.longitude
      );

      // Save location data
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

      // 🆕 Nếu đây là vị trí đầu tiên, tạo safe zone
      if (isFirstLocation) {
        console.log(`🏡 Đây là vị trí ĐẦU TIÊN, tạo safe zone...`);
        await this.createSafeZoneFromFirstLocation(device);
      }

      // Update device last seen
      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${device.petId.name}`);

      // Gửi config
      console.log(`⚙️ AUTO-SENDING CONFIG to ${deviceId}`);
      await this.sendConfigToDevice(deviceId);

      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();

      console.log(`✅ Config sent to ${deviceId} successfully`);
    } catch (error) {
      console.error("❌ Error saving location data:", error);
    }
  }

  // 🔥 SỬA HÀM: Gửi config - Ưu tiên safe zone autoCreated
  async sendConfigToDevice(deviceId) {
    try {
      console.log(`⚙️ Preparing config for device: ${deviceId}`);

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

      if (!device.petId) {
        console.log(`❌ Pet not found for device: ${deviceId}`);
        return;
      }

      if (!device.owner || !device.owner.phone) {
        console.log(`❌ Owner or phone not found for device: ${deviceId}`);
        return;
      }

      // Lấy safe zone autoCreated đầu tiên
      let safeZoneInfo = null;
      if (device.petId.safeZones && device.petId.safeZones.length > 0) {
        // Ưu tiên tìm safe zone autoCreated
        const autoCreatedZone = device.petId.safeZones.find(
          (zone) => zone.autoCreated === true
        );

        if (autoCreatedZone) {
          console.log(`📍 Tìm thấy safe zone tự động tạo từ vị trí đầu tiên`);
          safeZoneInfo = {
            center: {
              lat: autoCreatedZone.center.lat,
              lng: autoCreatedZone.center.lng,
            },
            radius: autoCreatedZone.radius || 100,
            name: autoCreatedZone.name || "Vị trí an toàn chính",
            isActive: autoCreatedZone.isActive !== false,
            autoCreated: true,
          };
        } else {
          // Nếu không có autoCreated, lấy safe zone đầu tiên
          const firstZone = device.petId.safeZones[0];
          if (firstZone && firstZone.center) {
            safeZoneInfo = {
              center: {
                lat: firstZone.center.lat,
                lng: firstZone.center.lng,
              },
              radius: firstZone.radius || 100,
              name: firstZone.name || "Safe Zone",
              isActive: firstZone.isActive !== false,
              autoCreated: false,
            };
          }
        }
      }

      // Tạo config
      const config = {
        success: true,
        _source: "server",
        deviceId: device.deviceId,
        petId: device.petId._id.toString(),
        petName: device.petId.name,
        phoneNumber: device.owner.phone,
        ownerName: device.owner.name,
        serverUrl:
          process.env.SERVER_URL || "https://pettracking2.onrender.com",
        updateInterval: 30000,
        timestamp: new Date().toISOString(),
        message: "Configuration from Pet Tracker Server",
        configSentAt: device.lastConfigSent
          ? device.lastConfigSent.toISOString()
          : new Date().toISOString(),
      };

      // Thêm safe zone nếu có
      if (safeZoneInfo) {
        config.safeZone = safeZoneInfo;
        console.log(
          `📍 Safe zone: ${safeZoneInfo.name} (${safeZoneInfo.radius}m)`
        );
        console.log(
          `   Loại: ${
            safeZoneInfo.autoCreated
              ? "Tự động tạo từ vị trí đầu tiên"
              : "Thủ công"
          }`
        );
      }

      console.log(`✅ Config prepared for ${deviceId}:`);
      console.log(`   Pet: ${config.petName}`);
      console.log(`   Phone: ${config.phoneNumber}`);
      console.log(`   Has Safe Zone: ${!!config.safeZone}`);
      console.log(
        `   First location captured: ${
          device.firstLocationCaptured ? "YES" : "NO"
        }`
      );

      // Publish config
      this.publishConfig(deviceId, config);
    } catch (error) {
      console.error("❌ Error sending config:", error);
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
        .populate("petId", "name species breed safeZones")
        .populate("owner", "name phone");

      if (!device) {
        console.log(`❌ Device not found or inactive: ${deviceId}`);
        return;
      }

      console.log(`⚙️ Sending config to ${deviceId} as requested`);
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

  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot publish");
      return;
    }

    const topic = `pets/${deviceId}/config`;

    console.log(`\n📤 PUBLISHING CONFIG:`);
    console.log(`   Topic: ${topic}`);
    console.log(`   Device: ${config.deviceId}`);
    console.log(`   Pet: ${config.petName}`);

    this.client.publish(
      topic,
      JSON.stringify(config),
      { qos: 1, retain: true },
      (err) => {
        if (err) {
          console.error(`❌ Failed to publish config:`, err);
        } else {
          console.log(`✅ Config published to: ${topic}`);
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
    console.log(`🔧 Manual config publish for: ${deviceId}`);
    await this.sendConfigToDevice(deviceId);
  }
}

module.exports = new MQTTService();
