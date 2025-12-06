// mqttSubscriber.js
const mqtt = require("mqtt");
const mongoose = require("mongoose");
const PetData = require("./models/petData");
const Device = require("./models/device");
const Pet = require("./models/pet");

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

      // 1. Tìm device với thông tin đầy đủ
      const device = await Device.findOne({ deviceId }).populate({
        path: "petId",
        populate: {
          path: "owner",
          select: "phone",
        },
      });

      if (!device || !device.petId) {
        console.log(`❌ Device or pet not found: ${deviceId}`);
        return;
      }

      const pet = device.petId;
      const ownerPhone = pet.owner?.phone;
      const safeZones = pet.safeZones || [];

      console.log(`📱 Owner phone: ${ownerPhone}`);
      console.log(`🏠 Safe zones count: ${safeZones.length}`);

      // 2. Tạo PetData với payload tối giản từ ESP32
      const petData = new PetData({
        petId: pet._id,
        latitude: data.lat || data.latitude,
        longitude: data.lng || data.longitude,
        timestamp: new Date(),
      });

      // 3. Chỉ thêm các field nếu ESP32 gửi
      if (data.spd !== undefined || data.speed !== undefined) {
        petData.speed = data.spd || data.speed || 0;
      }

      if (data.bat !== undefined || data.batteryLevel !== undefined) {
        petData.batteryLevel = data.bat || data.batteryLevel;
      }

      // 4. Thêm sensor data nếu ESP32 gửi
      if (data.accX !== undefined) {
        petData.accelX = data.accX;
        petData.accelY = data.accY || null;
        petData.accelZ = data.accZ || null;
      }

      if (data.gyroX !== undefined) {
        petData.gyroX = data.gyroX;
        petData.gyroY = data.gyroY || null;
        petData.gyroZ = data.gyroZ || null;
      }

      if (data.tmp !== undefined || data.temperature !== undefined) {
        petData.temperature = data.tmp || data.temperature;
      }

      if (data.alt !== undefined || data.altitude !== undefined) {
        petData.altitude = data.alt || data.altitude;
      }

      if (data.acc !== undefined || data.accuracy !== undefined) {
        petData.accuracy = data.acc || data.accuracy;
      }

      if (data.sig !== undefined || data.signalStrength !== undefined) {
        petData.signalStrength = data.sig || data.signalStrength;
      }

      // 5. Thêm metadata từ database
      petData.metadata = {
        ownerPhone: ownerPhone,
        safeZoneCount: safeZones.length,
        deviceId: deviceId,
      };

      // 6. Kiểm tra vùng an toàn
      const safeZoneCheck = petData.checkSafeZone(safeZones);
      if (safeZoneCheck.isInSafeZone) {
        petData.metadata.safeZoneCheck = true;
        petData.metadata.safeZoneName = safeZoneCheck.zoneName;
        console.log(`✅ Pet is in safe zone: ${safeZoneCheck.zoneName}`);
      } else {
        console.log(`⚠️  Pet is OUTSIDE safe zones!`);
        // Gửi cảnh báo nếu ra ngoài vùng an toàn
        await this.sendSafetyAlert(deviceId, pet, petData, ownerPhone);
      }

      await petData.save();

      // 7. Cập nhật lastSeen cho device
      device.lastSeen = new Date();
      await device.save();

      console.log(`📍 Location saved for ${deviceId} → ${pet.name}`);

      // 8. Gửi phản hồi config nếu cần
      await this.sendDeviceConfig(deviceId, pet, ownerPhone, safeZones);
    } catch (error) {
      console.error("❌ Error saving location data:", error);
    }
  }

  async sendSafetyAlert(deviceId, pet, petData, ownerPhone) {
    try {
      const alertTopic = `pets/${deviceId}/alert`;
      const alertMessage = {
        type: "OUT_OF_SAFE_ZONE",
        petName: pet.name,
        latitude: petData.latitude,
        longitude: petData.longitude,
        timestamp: new Date().toISOString(),
        ownerPhone: ownerPhone,
        message: `⚠️ ${pet.name} has left the safe zone!`,
      };

      this.client.publish(alertTopic, JSON.stringify(alertMessage), { qos: 2 });
      console.log(`🚨 Safety alert sent for ${pet.name}`);

      // TODO: Gửi SMS nếu có tích hợp SMS gateway
      // await this.sendSMSAlert(ownerPhone, alertMessage);
    } catch (error) {
      console.error("❌ Error sending safety alert:", error);
    }
  }

  // ... (phần trên giữ nguyên)

  async sendDeviceConfig(deviceId, pet, ownerPhone, safeZones) {
    try {
      const configTopic = `pets/${deviceId}/config`;

      // ⭐ FORMAT SAFE ZONES VỚI BÁN KÍNH
      const formattedSafeZones = safeZones.map((zone, index) => ({
        zone_id: zone._id || `safe_zone_${index + 1}`,
        zone_name: zone.name || `Safe Zone ${index + 1}`,
        center_lat: zone.center.lat,
        center_lng: zone.center.lng,
        radius_meters: zone.radius, // ⭐ BÁN KÍNH
        radius_feet: Math.round(zone.radius * 3.28084),
        is_active: zone.isActive !== false,
        alert_margin: 50, // Biên độ cảnh báo thêm (mét)
        created_at: zone.createdAt || new Date().toISOString(),
      }));

      const config = {
        petId: pet._id,
        petName: pet.name,
        ownerPhone: ownerPhone,

        // ⭐ THÔNG TIN VÙNG AN TOÀN ĐẦY ĐỦ
        safe_zones: formattedSafeZones,
        safe_zones_metadata: {
          total: formattedSafeZones.length,
          active: formattedSafeZones.filter((z) => z.is_active).length,
          max_radius: Math.max(
            ...formattedSafeZones.map((z) => z.radius_meters)
          ),
          average_radius: Math.round(
            formattedSafeZones.reduce((sum, z) => sum + z.radius_meters, 0) /
              formattedSafeZones.length
          ),
        },

        // Cấu hình tracking
        tracking_config: {
          update_interval: 30000,
          gps_timeout: 60000,
          movement_threshold: 0.5,
          battery_save_mode: true,
          geofence_check: true,
        },

        // Thông tin server
        server: {
          url: process.env.SERVER_URL || "https://pettracking2.onrender.com",
          api_endpoint: "/api/petData",
          health_check: "/health",
        },

        timestamp: new Date().toISOString(),
        config_version: "1.3",
      };

      this.client.publish(configTopic, JSON.stringify(config), {
        qos: 1,
        retain: true,
      });

      console.log(`⚙️ Config sent to ${deviceId}`);
      console.log(
        `📏 Safe zones radii: ${formattedSafeZones
          .map((z) => `${z.radius_meters}m`)
          .join(", ")}`
      );
    } catch (error) {
      console.error("❌ Error sending device config:", error);
    }
  }

  // ... (phần dưới giữ nguyên)

  async handleStatusUpdate(deviceId, data) {
    try {
      await Device.findOneAndUpdate(
        { deviceId },
        {
          lastSeen: new Date(),
          batteryLevel: data.batteryLevel || data.bat,
          signalStrength: data.signalStrength || data.sig,
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
      // Implement alerts here
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
    this.client.publish(topic, JSON.stringify(config), { qos: 1 });
    console.log(`⚙️ Config sent to ${deviceId}`);
  }

  getConnectionStatus() {
    return this.isConnected;
  }
}

module.exports = new MQTTService();
