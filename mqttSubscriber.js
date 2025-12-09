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
        config: "pets/+/config", // Thêm để listen config request
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

  // 🆕 THÊM HÀM MỚI: Tạo safe zone từ vị trí đầu tiên
  async createSafeZoneFromFirstLocation(deviceId, petId, latitude, longitude) {
    try {
      console.log(
        `🏡 Tạo safe zone từ vị trí đầu tiên cho device: ${deviceId}`
      );

      const Pet = require("./models/pet");

      // Kiểm tra xem pet đã có safe zone chưa
      const pet = await Pet.findById(petId);
      if (!pet) {
        console.log(`❌ Pet not found: ${petId}`);
        return null;
      }

      // 🆕 CÁCH CHÍNH XÁC: Kiểm tra xem pet đã có safe zone nào có autoCreated = true chưa
      const hasAutoCreatedZone =
        pet.safeZones &&
        pet.safeZones.some((zone) => zone.autoCreated === true);

      if (hasAutoCreatedZone) {
        console.log(
          `ℹ️ Pet ${pet.name} đã có safe zone tự động tạo, không tạo mới`
        );
        return null;
      }

      // Tạo safe zone mới từ vị trí đầu tiên
      const safeZoneData = {
        name: "Vị trí an toàn chính",
        center: {
          lat: latitude,
          lng: longitude,
        },
        radius: 100, // Bán kính 100m mặc định
        isActive: true,
        isPrimary: true, // Đánh dấu là safe zone chính
        autoCreated: true, // Đánh dấu là tự động tạo
        notes: "Tự động tạo từ vị trí đầu tiên ESP32 gửi về",
        createdAt: new Date(),
      };

      // Thêm safe zone mới
      if (!pet.safeZones) pet.safeZones = [];
      pet.safeZones.push(safeZoneData);
      await pet.save();

      console.log(`✅ Đã tạo safe zone từ vị trí đầu tiên:`);
      console.log(`   Pet: ${pet.name}`);
      console.log(`   Vị trí: ${latitude}, ${longitude}`);
      console.log(`   Bán kính: 100m`);
      console.log(`   Tự động tạo: CÓ`);
      console.log(`   Thời gian: ${new Date().toLocaleTimeString("vi-VN")}`);

      return safeZoneData;
    } catch (error) {
      console.error("❌ Lỗi tạo safe zone từ vị trí đầu tiên:", error);
      return null;
    }
  }

  // 🔥 SỬA: HÀM XỬ LÝ LOCATION - CHỈ TẠO SAFE ZONE KHI PET CHƯA CÓ
  async handleLocationData(deviceId, data) {
    try {
      console.log(`📍 Processing location for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId }).populate("petId");
      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

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

      // 🆕 LOGIC MỚI: Kiểm tra và tạo safe zone nếu pet chưa có safe zone autoCreated
      const Pet = require("./models/pet");
      const pet = await Pet.findById(device.petId._id);

      if (pet) {
        const hasAutoCreatedZone =
          pet.safeZones &&
          pet.safeZones.some((zone) => zone.autoCreated === true);

        if (!hasAutoCreatedZone) {
          console.log(
            `🎯 PET CHƯA CÓ SAFE ZONE TỰ ĐỘNG TẠO, TẠO MỚI TỪ VỊ TRÍ NÀY`
          );

          // Tạo safe zone từ vị trí hiện tại (vị trí đầu tiên được ghi nhận)
          await this.createSafeZoneFromFirstLocation(
            deviceId,
            device.petId._id,
            data.latitude,
            data.longitude
          );
        }
      }

      // Update device
      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${device.petId.name}`);

      // 🔥 🔥 🔥 QUAN TRỌNG: LUÔN GỬI CONFIG KHI NHẬN LOCATION
      console.log(
        `⚙️ AUTO-SENDING CONFIG to ${deviceId} (triggered by location)`
      );

      // Gửi config đến device
      await this.sendConfigToDevice(deviceId);

      // Cập nhật trạng thái
      device.configSent = true;
      device.lastConfigSent = new Date();
      await device.save();

      console.log(`✅ Config sent to ${deviceId} successfully`);
    } catch (error) {
      console.error("❌ Error saving location data:", error);
    }
  }

  // 🔥 FIXED: HÀM XỬ LÝ STATUS - CHECK CONFIG REQUEST
  async handleStatusUpdate(deviceId, data) {
    try {
      console.log(`🔋 Processing status for device: ${deviceId}`);

      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`❌ Device not found in status update: ${deviceId}`);
        return;
      }

      // Cập nhật thông tin device
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

      // 🔥 Gửi config nếu device báo cần
      if (
        data.needConfig === true ||
        data.configReceived === false ||
        !device.configSent
      ) {
        console.log(`⚙️ Device ${deviceId} needs config (from status message)`);

        // Đợi 1 giây rồi gửi config
        setTimeout(async () => {
          await this.sendConfigToDevice(deviceId);

          // Cập nhật trạng thái
          device.configSent = true;
          device.lastConfigSent = new Date();
          await device.save();
        }, 1000);
      }
    } catch (error) {
      console.error("❌ Error updating device status:", error);
    }
  }

  // 🔥 NEW: HÀM XỬ LÝ CONFIG REQUEST
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

      // Cập nhật trạng thái
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

  // 🔥 FIXED: HÀM GỬI CONFIG ĐẾN DEVICE
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

      // Validate required data
      if (!device.petId) {
        console.log(`❌ Pet not found for device: ${deviceId}`);
        return;
      }

      if (!device.owner || !device.owner.phone) {
        console.log(`❌ Owner or phone not found for device: ${deviceId}`);
        return;
      }

      // Lấy thông tin vùng an toàn
      let safeZoneInfo = null;
      if (device.petId.safeZones && device.petId.safeZones.length > 0) {
        // Ưu tiên safe zone autoCreated (tự động tạo từ vị trí đầu tiên)
        const autoCreatedZone = device.petId.safeZones.find(
          (zone) => zone.autoCreated === true
        );
        const activeZone =
          autoCreatedZone ||
          device.petId.safeZones.find((zone) => zone.isActive) ||
          device.petId.safeZones[0];

        if (activeZone && activeZone.center) {
          safeZoneInfo = {
            center: {
              lat: activeZone.center.lat,
              lng: activeZone.center.lng,
            },
            radius: activeZone.radius || 100,
            name: activeZone.name || "Safe Zone",
            isActive: activeZone.isActive !== false,
            autoCreated: activeZone.autoCreated || false,
          };
        }
      }

      // Tạo config message
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
          `📍 Safe zone included: ${safeZoneInfo.name} (${safeZoneInfo.radius}m)`
        );
        if (safeZoneInfo.autoCreated) {
          console.log(`   ⚡ Loại: Tự động tạo từ vị trí đầu tiên`);
        }
      }

      console.log(`✅ Config prepared for ${deviceId}:`);
      console.log(`   Pet: ${config.petName}`);
      console.log(`   Phone: ${config.phoneNumber}`);
      console.log(`   Has Safe Zone: ${!!config.safeZone}`);

      // Publish config với retain flag
      this.publishConfig(deviceId, config);
    } catch (error) {
      console.error("❌ Error sending config:", error);
    }
  }

  // 🔥 FIXED: HÀM PUBLISH CONFIG
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

    // Publish với retain: true để ESP32 nhận được ngay khi connect
    this.client.publish(
      topic,
      JSON.stringify(config),
      { qos: 1, retain: true },
      (err) => {
        if (err) {
          console.error(`❌ Failed to publish config:`, err);
        } else {
          console.log(`✅ Config published to: ${topic}`);
          console.log(`   Retained: YES (ESP32 will get it immediately)`);
        }
      }
    );
  }

  // Hàm clear retained messages
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

  // Helper để manual publish config
  async manualPublishConfig(deviceId) {
    console.log(`🔧 Manual config publish for: ${deviceId}`);
    await this.sendConfigToDevice(deviceId);
  }
}

module.exports = new MQTTService();
