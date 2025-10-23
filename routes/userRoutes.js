const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.JWT_SECRET || "mysecretkey"; // bạn có thể đặt trong Render env

// ... giữ nguyên phần register

// Login user (simple version - just check credentials)
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").exists().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // 🔥 Tạo token JWT
      const token = jwt.sign({ id: user._id }, SECRET_KEY, { expiresIn: "7d" });

      res.json({
        success: true,
        message: "Login successful",
        token, // gửi token về cho frontend
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);
