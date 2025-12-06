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
        command: "pets/+/command", // Thêm topic cho commands
      },
    };

    this.client = null;
    this.isConnected = false;
    this.lastMessageTime = null;
    this.metrics = {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      lastError: null,
    };
  }

  async connect() {
    try {
      console.log("🔗 Connecting to EMQX Cloud...");
      console.log("📝 Broker:", this.config.brokerUrl);
      console.log("👤 Username:", this.config.username);
      console.log("📡 Client ID:", this.config.clientId);

      this.client = mqtt.connect(this.config.brokerUrl, {
        username: this.config.username,
        password: this.config.password,
        clientId: this.config.clientId,
        clean: this.config.clean,
        reconnectPeriod: this.config.reconnectPeriod,
        connectTimeout: this.config.connectTimeout,
        keepalive: 60, // 60 seconds keepalive
        protocolVersion: 4, // MQTT v3.1.1
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

    this.client.on("message", (topic, message) => {
      this.metrics.messagesReceived++;
      this.lastMessageTime = new Date();
      this.handleMessage(topic, message).catch((error) => {
        console.error("❌ Error in message handler:", error);
        this.metrics.errors++;
        this.metrics.lastError = {
          timestamp: new Date(),
          message: error.message,
        };
      });
    });

    this.client.on("error", (error) => {
      console.error("❌ MQTT Error:", error);
      this.isConnected = false;
      this.metrics.errors++;
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

    this.client.on("packetsend", (packet) => {
      if (packet.cmd === "publish") {
        console.log(`📤 MQTT Packet sent to ${packet.topic}`);
      }
    });

    this.client.on("packetreceive", (packet) => {
      if (packet.cmd === "publish") {
        console.log(`📥 MQTT Packet received from ${packet.topic}`);
      }
    });
  }

  subscribeToTopics() {
    const topics = Object.values(this.config.topics);
    topics.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`✅ Subscribed to: ${topic} (QoS: 1)`);
        }
      });
    });
  }

  async handleMessage(topic, message) {
    try {
      let payload;

      try {
        payload = JSON.parse(message.toString());
      } catch (parseError) {
        console.error(
          `❌ Failed to parse JSON from ${topic}:`,
          message.toString()
        );
        return;
      }

      console.log(
        `📨 MQTT Message [${topic}]:`,
        JSON.stringify(payload, null, 2)
      );

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

        case topic.includes("/config"):
          await this.handleConfigResponse(deviceId, payload);
          break;

        case topic.includes("/command"):
          await this.handleCommand(deviceId, payload);
          break;

        default:
          console.log("📝 Unknown topic:", topic);
      }

      this.metrics.messagesProcessed++;
    } catch (error) {
      console.error("❌ Error processing MQTT message:", error);
      this.metrics.errors++;
      this.metrics.lastError = {
        timestamp: new Date(),
        message: error.message,
        stack: error.stack,
      };
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
          select: "phone name",
        },
      });

      if (!device || !device.petId) {
        console.log(`❌ Device or pet not found: ${deviceId}`);
        await this.sendErrorToDevice(
          deviceId,
          "DEVICE_NOT_REGISTERED",
          "Device chưa đăng ký với pet"
        );
        return;
      }

      const pet = device.petId;
      const ownerPhone = pet.owner?.phone;
      const safeZones = pet.safeZones || [];

      console.log(
        `📱 Owner: ${pet.owner?.name || "N/A"} (${ownerPhone || "No phone"})`
      );
      console.log(`🏠 Safe zones: ${safeZones.length} zones`);

      // 2. Validate dữ liệu từ ESP32
      if (!data.lat && !data.latitude) {
        console.log(`❌ Invalid location data from ${deviceId}`);
        return;
      }

      // 3. Tạo PetData với payload tối giản
      const petData = new PetData({
        petId: pet._id,
        latitude: data.lat || data.latitude,
        longitude: data.lng || data.longitude,
        timestamp: new Date(),
      });

      // 4. Chỉ thêm các field nếu ESP32 gửi (tối ưu hóa bandwidth)
      if (data.spd !== undefined || data.speed !== undefined) {
        petData.speed = data.spd || data.speed || 0;
      }

      if (data.bat !== undefined || data.batteryLevel !== undefined) {
        const batteryLevel = data.bat || data.batteryLevel;
        petData.batteryLevel = batteryLevel;

        // Gửi cảnh báo pin thấp
        if (batteryLevel < 20) {
          await this.sendLowBatteryAlert(
            deviceId,
            pet,
            batteryLevel,
            ownerPhone
          );
        }
      }

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
        ownerName: pet.owner?.name,
        safeZoneCount: safeZones.length,
        deviceId: deviceId,
        petName: pet.name,
        deviceLastSeen: device.lastSeen,
      };

      // 6. KIỂM TRA VỚI TẤT CẢ SAFE ZONES
      if (safeZones.length > 0) {
        const zoneCheckResult = await this.checkAllSafeZones(
          petData,
          safeZones
        );

        if (zoneCheckResult.isInAnySafeZone) {
          console.log(
            `✅ Pet in safe zone: ${
              zoneCheckResult.zoneName
            } (${zoneCheckResult.distance.toFixed(1)}m)`
          );
          petData.metadata.safeZoneCheck = true;
          petData.metadata.safeZoneName = zoneCheckResult.zoneName;
          petData.metadata.currentZoneDistance = zoneCheckResult.distance;
          petData.metadata.zoneRadius = zoneCheckResult.radius;
        } else {
          console.log(`⚠️  Pet OUTSIDE all safe zones!`);
          console.log(
            `📍 Nearest: ${
              zoneCheckResult.nearestZone?.name || "N/A"
            } (${zoneCheckResult.minDistance.toFixed(1)}m)`
          );

          petData.metadata.safeZoneCheck = false;
          petData.metadata.nearestZoneDistance = zoneCheckResult.minDistance;
          petData.metadata.nearestZoneName = zoneCheckResult.nearestZone?.name;
          petData.metadata.nearestZoneRadius =
            zoneCheckResult.nearestZone?.radius;

          // Gửi cảnh báo nếu ra ngoài safe zone
          await this.sendSafetyAlert(
            deviceId,
            pet,
            petData,
            ownerPhone,
            zoneCheckResult.nearestZone,
            zoneCheckResult.minDistance
          );
        }
      } else {
        console.log("ℹ️  No safe zones configured for this pet");
        petData.metadata.safeZoneCheck = null;
      }

      // 7. Lưu dữ liệu
      await petData.save();
      console.log(`💾 Location saved for ${pet.name} (${deviceId})`);

      // 8. Cập nhật lastSeen cho device
      device.lastSeen = new Date();
      if (petData.batteryLevel !== null) {
        device.batteryLevel = petData.batteryLevel;
      }
      if (petData.signalStrength !== null) {
        device.signalStrength = petData.signalStrength;
      }
      await device.save();

      // 9. Gửi acknowledgment cho ESP32
      await this.sendAcknowledgment(deviceId, {
        status: "RECEIVED",
        timestamp: new Date().toISOString(),
        petName: pet.name,
        batteryLevel: petData.batteryLevel,
        safeZoneStatus: petData.metadata.safeZoneCheck ? "INSIDE" : "OUTSIDE",
      });

      // 10. Gửi real-time update cho frontend (nếu có WebSocket)
      await this.sendRealTimeUpdateToFrontend(pet, petData);
    } catch (error) {
      console.error("❌ Error handling location data:", error);
      this.metrics.errors++;

      // Gửi error message cho ESP32
      await this.sendErrorToDevice(deviceId, "SERVER_ERROR", error.message);
    }
  }

  async checkAllSafeZones(petData, safeZones) {
    let isInAnySafeZone = false;
    let zoneName = null;
    let distance = null;
    let radius = null;
    let nearestZone = null;
    let minDistance = Infinity;

    for (const zone of safeZones) {
      if (!zone.isActive || !zone.center || !zone.radius) continue;

      const currentDistance = petData.calculateDistance(
        petData.latitude,
        petData.longitude,
        zone.center.lat,
        zone.center.lng
      );

      // Cập nhật zone gần nhất
      if (currentDistance < minDistance) {
        minDistance = currentDistance;
        nearestZone = zone;
      }

      // Kiểm tra có trong zone không
      if (currentDistance <= zone.radius) {
        isInAnySafeZone = true;
        zoneName = zone.name;
        distance = currentDistance;
        radius = zone.radius;
        break; // Tìm thấy zone đầu tiên thì dừng
      }
    }

    return {
      isInAnySafeZone,
      zoneName,
      distance,
      radius,
      nearestZone,
      minDistance,
    };
  }

  async sendSafetyAlert(
    deviceId,
    pet,
    petData,
    ownerPhone,
    nearestZone,
    distance
  ) {
    try {
      const alertTopic = `pets/${deviceId}/alert`;
      const alertMessage = {
        type: "OUT_OF_SAFE_ZONE",
        level: "DANGER",
        petName: pet.name,
        petId: pet._id,
        latitude: petData.latitude,
        longitude: petData.longitude,
        timestamp: new Date().toISOString(),
        ownerPhone: ownerPhone,
        ownerName: pet.owner?.name,
        message: `⚠️ ${pet.name} đã ra khỏi vùng an toàn!`,
        details: {
          nearestZone: nearestZone?.name || "Không có vùng an toàn nào gần",
          distance: distance.toFixed(1),
          zoneRadius: nearestZone?.radius,
          safeZonesCount: pet.safeZones?.length || 0,
          coordinates: {
            lat: petData.latitude,
            lng: petData.longitude,
          },
        },
        actions: [
          {
            type: "VIEW_ON_MAP",
            url: `${process.env.FRONTEND_URL}/dashboard?pet=${pet._id}`,
          },
          { type: "CALL_OWNER", phone: ownerPhone },
        ],
      };

      // Gửi qua MQTT với QoS 2 (chính xác một lần)
      this.client.publish(alertTopic, JSON.stringify(alertMessage), {
        qos: 2,
        retain: true, // Giữ lại alert để device nhận khi reconnect
      });

      console.log(`🚨 Safety alert sent to ${deviceId}`);
      console.log(`📞 Owner notified: ${ownerPhone}`);

      // TODO: Gửi SMS/Email notification nếu tích hợp
      // await this.sendSMSNotification(ownerPhone, alertMessage);
    } catch (error) {
      console.error("❌ Error sending safety alert:", error);
    }
  }

  async sendLowBatteryAlert(deviceId, pet, batteryLevel, ownerPhone) {
    try {
      const alertTopic = `pets/${deviceId}/alert`;
      const alertMessage = {
        type: "LOW_BATTERY",
        level: "WARNING",
        petName: pet.name,
        batteryLevel: batteryLevel,
        timestamp: new Date().toISOString(),
        ownerPhone: ownerPhone,
        message: `🔋 ${pet.name} pin yếu: ${batteryLevel}%`,
        recommendedAction: "Sạc thiết bị ngay",
      };

      this.client.publish(alertTopic, JSON.stringify(alertMessage), {
        qos: 1,
        retain: false,
      });

      console.log(
        `⚠️ Low battery alert sent for ${pet.name} (${batteryLevel}%)`
      );
    } catch (error) {
      console.error("❌ Error sending low battery alert:", error);
    }
  }

  async sendAcknowledgment(deviceId, data) {
    try {
      const ackTopic = `pets/${deviceId}/ack`;
      const ackMessage = {
        type: "LOCATION_ACK",
        timestamp: new Date().toISOString(),
        ...data,
      };

      this.client.publish(ackTopic, JSON.stringify(ackMessage), {
        qos: 0, // QoS 0 cho ack vì không quan trọng
        retain: false,
      });

      console.log(`✅ Ack sent to ${deviceId}`);
    } catch (error) {
      console.error("❌ Error sending acknowledgment:", error);
    }
  }

  async sendErrorToDevice(deviceId, errorCode, errorMessage) {
    try {
      const errorTopic = `pets/${deviceId}/error`;
      const errorData = {
        type: "ERROR",
        errorCode: errorCode,
        message: errorMessage,
        timestamp: new Date().toISOString(),
        suggestion:
          errorCode === "DEVICE_NOT_REGISTERED"
            ? "Vui lòng đăng ký device qua web dashboard"
            : "Thử lại sau 30 giây",
      };

      this.client.publish(errorTopic, JSON.stringify(errorData), {
        qos: 1,
        retain: false,
      });

      console.log(`❌ Error sent to ${deviceId}: ${errorCode}`);
    } catch (error) {
      console.error("❌ Error sending error message:", error);
    }
  }

  async handleStatusUpdate(deviceId, data) {
    try {
      console.log(`🔋 Status update from ${deviceId}:`, data);

      await Device.findOneAndUpdate(
        { deviceId },
        {
          lastSeen: new Date(),
          batteryLevel: data.batteryLevel || data.bat,
          signalStrength: data.signalStrength || data.sig,
          firmwareVersion: data.firmwareVersion,
          isActive: true,
        },
        { upsert: false, new: true }
      );

      console.log(`✅ Device status updated: ${deviceId}`);

      // Gửi acknowledgment
      await this.sendAcknowledgment(deviceId, {
        status: "STATUS_UPDATED",
        message: "Device status received",
      });
    } catch (error) {
      console.error("❌ Error updating device status:", error);
    }
  }

  async handleAlert(deviceId, data) {
    try {
      console.log(`🚨 ALERT from ${deviceId}:`, data);

      // Log alert vào database (nếu cần)
      // Có thể gửi notification cho admin/owner

      // Gửi acknowledgment
      await this.sendAcknowledgment(deviceId, {
        status: "ALERT_RECEIVED",
        alertType: data.type,
        message: "Alert received by server",
      });
    } catch (error) {
      console.error("❌ Error handling alert:", error);
    }
  }

  async handleConfigResponse(deviceId, data) {
    try {
      console.log(`⚙️ Config response from ${deviceId}:`, data);

      // Ghi nhận device đã nhận config
      await Device.findOneAndUpdate(
        { deviceId },
        {
          lastConfigUpdate: new Date(),
          configVersion: data.configVersion,
          configStatus: "RECEIVED",
        }
      );

      console.log(`✅ Config acknowledged by ${deviceId}`);
    } catch (error) {
      console.error("❌ Error handling config response:", error);
    }
  }

  async handleCommand(deviceId, data) {
    try {
      console.log(`🎛️ Command from ${deviceId}:`, data);

      switch (data.command) {
        case "GET_CONFIG":
          await this.sendDeviceConfig(deviceId);
          break;

        case "PING":
          await this.sendAcknowledgment(deviceId, {
            status: "PONG",
            timestamp: new Date().toISOString(),
          });
          break;

        case "REBOOT":
          console.log(`🔄 Reboot command received for ${deviceId}`);
          // Có thể ghi log hoặc thông báo cho admin
          break;

        default:
          console.log(`❓ Unknown command from ${deviceId}: ${data.command}`);
      }
    } catch (error) {
      console.error("❌ Error handling command:", error);
    }
  }

  async sendDeviceConfig(deviceId) {
    try {
      console.log(`🔧 Sending config to ${deviceId}`);

      const device = await Device.findOne({ deviceId }).populate({
        path: "petId",
        populate: {
          path: "owner",
          select: "phone name",
        },
      });

      if (!device) {
        console.log(`❌ Device not found: ${deviceId}`);
        return;
      }

      const pet = device.petId;
      const safeZones = pet.safeZones || [];

      // Format safe zones cho ESP32
      const formattedSafeZones = safeZones.map((zone, index) => ({
        zone_id: zone._id || `zone_${index}`,
        name: zone.name || `Safe Zone ${index + 1}`,
        center_lat: zone.center.lat,
        center_lng: zone.center.lng,
        radius_meters: zone.radius || 100,
        is_active: zone.isActive !== false,
        color: zone.color || "#10B981",
        alert_margin: 10, // Biên độ cảnh báo thêm 10m
      }));

      const config = {
        type: "CONFIG_UPDATE",
        deviceId: deviceId,
        petId: pet._id,
        petName: pet.name,
        ownerPhone: pet.owner?.phone,
        ownerName: pet.owner?.name,
        safe_zones: formattedSafeZones,
        tracking_config: {
          update_interval: 30000, // 30 giây
          gps_timeout: 60000, // 60 giây
          movement_threshold: 0.5, // 0.5 m/s
          battery_save_mode: true,
          geofence_check: true,
        },
        server_config: {
          mqtt_broker: process.env.MQTT_BROKER_URL,
          mqtt_username: process.env.MQTT_USERNAME,
          mqtt_password: process.env.MQTT_PASSWORD,
          api_url:
            process.env.SERVER_URL || "https://pettracking2.onrender.com",
        },
        timestamp: new Date().toISOString(),
        config_version: "2.0",
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(), // 7 ngày
      };

      const configTopic = `pets/${deviceId}/config`;
      this.client.publish(configTopic, JSON.stringify(config), {
        qos: 1,
        retain: true, // Giữ lại để device luôn nhận được khi reconnect
      });

      console.log(`⚙️ Config sent to ${deviceId}`);
      console.log(`📏 Safe zones: ${formattedSafeZones.length} zones`);
    } catch (error) {
      console.error("❌ Error sending device config:", error);
    }
  }

  async sendRealTimeUpdateToFrontend(pet, petData) {
    // TODO: Implement WebSocket hoặc Socket.io để gửi real-time update
    // Hiện tại chỉ log
    console.log(`🌐 Real-time update available for ${pet.name}`);
  }

  publishConfig(deviceId, config) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot publish");
      return;
    }

    const topic = `pets/${deviceId}/config`;
    this.client.publish(topic, JSON.stringify(config), { qos: 1 });
    console.log(`⚙️ Config published to ${deviceId}`);
  }

  sendCommand(deviceId, command, data = {}) {
    if (!this.isConnected) {
      console.log("❌ MQTT not connected, cannot send command");
      return false;
    }

    const topic = `pets/${deviceId}/command`;
    const payload = {
      command: command,
      timestamp: new Date().toISOString(),
      ...data,
    };

    this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
    console.log(`🎛️ Command '${command}' sent to ${deviceId}`);
    return true;
  }

  getConnectionStatus() {
    return this.isConnected;
  }

  getMetrics() {
    return {
      ...this.metrics,
      isConnected: this.isConnected,
      lastMessageTime: this.lastMessageTime,
      uptime: this.isConnected ? process.uptime() : 0,
    };
  }

  // Graceful shutdown
  async disconnect() {
    if (this.client && this.client.connected) {
      console.log("🛑 Disconnecting MQTT client...");
      this.client.end();
      this.isConnected = false;
    }
  }

  // Health check
  healthCheck() {
    return {
      status: this.isConnected ? "healthy" : "unhealthy",
      connected: this.isConnected,
      broker: this.config.brokerUrl,
      topics: Object.keys(this.config.topics),
      messagesReceived: this.metrics.messagesReceived,
      messagesProcessed: this.metrics.messagesProcessed,
      errors: this.metrics.errors,
      lastError: this.metrics.lastError,
      uptime: process.uptime(),
    };
  }
}

// Tạo singleton instance
const mqttService = new MQTTService();

// Auto-reconnect monitoring
setInterval(() => {
  if (
    !mqttService.isConnected &&
    mqttService.client &&
    !mqttService.client.reconnecting
  ) {
    console.log("🔄 Attempting to reconnect MQTT...");
    mqttService.connect().catch(console.error);
  }
}, 10000); // Check every 10 seconds

module.exports = mqttService;
