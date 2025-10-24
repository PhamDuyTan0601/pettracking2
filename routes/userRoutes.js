const { Resend } = require("resend");

// ==============================
// 🔁 Forgot Password (Dùng Resend)
// ==============================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("📧 Forgot password request for:", email);

    // Luôn trả về success để bảo mật
    if (!email) {
      return res.json({
        success: true,
        message: "If the email exists, a reset link has been sent",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log("📧 Email not found (security response)");
      return res.json({
        success: true,
        message: "If the email exists, a reset link has been sent",
      });
    }

    console.log("✅ User found:", user.email);

    // Tạo reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = await bcrypt.hash(resetToken, 10);

    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    console.log("🔐 Reset token created");

    // Kiểm tra Resend API Key
    if (!process.env.RESEND_API_KEY) {
      console.error("❌ RESEND_API_KEY missing");
      return res.status(500).json({
        success: false,
        message: "Email service not configured",
      });
    }

    // Dùng Resend
    const resend = new Resend(process.env.RESEND_API_KEY);

    const resetLink = `${
      process.env.FRONTEND_URL || "https://pettracking.vercel.app"
    }/reset-password/${resetToken}`;
    console.log("🔗 Reset link created");

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Pet Tracker <onboarding@resend.dev>",
      to: user.email,
      subject: "Password Reset Request - Pet Tracker",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #3182ce; text-align: center;">🔐 Password Reset Request</h2>
          <p>Hello <strong>${user.name}</strong>,</p>
          <p>You requested to reset your password for your <strong>Pet Tracker</strong> account.</p>
          <p>Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" 
               style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
               🔑 Reset Password
            </a>
          </div>
          <p style="color: #718096; font-size: 14px;">
            <strong>Note:</strong> This link will expire in 15 minutes.
          </p>
          <p style="color: #718096; font-size: 14px;">
            If you didn't request this, please ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #a0aec0; font-size: 12px; text-align: center;">
            Pet Tracker - Track your pets with confidence
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("❌ Resend error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to send reset email",
      });
    }

    console.log("✅ Email sent successfully via Resend");
    console.log("📧 Email ID:", data?.id);

    res.json({
      success: true,
      message: "If the email exists, a reset link has been sent",
    });
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    res.json({
      success: true, // Vẫn trả về success để bảo mật
      message: "If the email exists, a reset link has been sent",
    });
  }
});
