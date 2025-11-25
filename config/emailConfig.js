const emailConfig = {
  imap: {
    user: "phamduytan26089@gmail.com", // THAY EMAIL CỦA BẠN
    password: "wncr ccya oznv kyqu", // THAY APP PASSWORD
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  },

  // Criteria for filtering emails
  criteria: {
    subject: "PET_EMERGENCY",
    // from: 'esp32@yourdomain.com' // Có thể thêm sau
  },

  pollingInterval: 60000, // 1 phút
};

module.exports = emailConfig;
