require("dotenv").config();
const User = require("../models/user_db");
const Restaurant = require("../models/restaurant_db");
const Order = require("../models/order_db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Log = require("../models/log_db");

// Initialize verificationData Map
const verificationData = new Map();
// Initialize resetTokens Map for password reset
const resetTokens = new Map();

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.eu",  // Zoho SMTP sunucusu
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


// Function to generate verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Function to generate a reset token
function generateResetToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// GET METHODS
module.exports.login = function (req, res) {
  res.render("login.ejs");
};

module.exports.register = function (req, res) {
  res.render("register.ejs");
};

module.exports.verification = function (req, res) {
  const email = req.query.email;
  console.log("Verification req.query:", req.query);
  if (!email || !verificationData.has(email)) {
    console.log("Email eksik veya verificationData'da yok:", email);
    return res.redirect("/account/register");
  }
  res.render("verification.ejs", { email });
};

module.exports.resetPassword = function (req, res) {
  res.render("reset-password.ejs");
};

module.exports.confirmResetPassword = function (req, res) {
  const { token } = req.query;
  if (!token || !resetTokens.has(token)) {
    return res.status(400).render("reset-password.ejs", {
      error: "Geçersiz veya süresi dolmuş token.",
    });
  }
  res.render("confirm_rp.ejs", { token });
};

// POST METHODS
module.exports.loginPost = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Geçersiz bilgiler" });
  }

  if (user.status !== "active") {
    return res.status(403).json({ error: "Hesabınız aktif değil" });
  }

  const token = jwt.sign(
    { uid: user._id, email: user.email, role: user.role || "student" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: "Strict",
  });

  res.json({
    message: "Giriş başarılı",
    role: user.role || "student",
  });
};

module.exports.sendCode = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "Tüm alanlar zorunludur" });
    }

    if (!email.endsWith("@itu.edu.tr")) {
      return res.status(400).json({
        error: "Sadece @itu.edu.tr uzantılı e-postalar kullanılabilir",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "E-posta zaten kayıtlı" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Şifre en az 6 karakter olmalı" });
    }

    const code = generateVerificationCode();
    verificationData.set(email, {
      firstName,
      lastName,
      password,
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Kayıt Doğrulama Kodu",
      text: `Merhaba ${firstName} ${lastName},\nKayıt işleminizi tamamlamak için doğrulama kodunuz: ${code}\nBu kod 5 dakika geçerlidir.`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Doğrulama kodu gönderildi" });
  } catch (err) {
    console.error("Error in /register/sendcode:", err);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
};

module.exports.verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    console.log("verifyCode req.body:", req.body);

    if (!email || !code) {
      return res.status(400).json({ error: "E-posta ve kod gerekli" });
    }

    const savedData = verificationData.get(email);
    if (!savedData) {
      return res
        .status(400)
        .json({ error: "Doğrulama kodu gönderilmedi veya süresi doldu" });
    }

    if (Date.now() > savedData.expiresAt) {
      verificationData.delete(email);
      return res.status(400).json({ error: "Doğrulama kodunun süresi doldu" });
    }

    if (savedData.code !== code.toString()) {
      return res.status(400).json({ error: "Geçersiz doğrulama kodu" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "E-posta zaten kayıtlı" });
    }

    const hashedPassword = await bcrypt.hash(savedData.password, 10);
    const user = await User.create({
      firstName: savedData.firstName,
      lastName: savedData.lastName,
      email,
      password: hashedPassword,
    });

    await Log.create({
      action: "Kullanıcı Kaydı",
      description: `${user.firstName} ${user.lastName} adlı kullanıcı (${user.email}) kaydoldu.`,
      user: user.email,
      role: user.role,
    });

    verificationData.delete(email);

    const token = jwt.sign(
      { uid: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });
    console.log("Cookie set: token=", token);

    res.json({
      message: "Kayıt ve giriş başarılı",
      redirect: "/user/usermain",
    });
  } catch (err) {
    console.error("Error in /register/verifycode:", err);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
};

module.exports.resendCode = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "E-posta gerekli" });

    if (!email.endsWith("@itu.edu.tr")) {
      return res.status(400).json({
        error: "Sadece @itu.edu.tr uzantılı e-postalar kullanılabilir",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "E-posta zaten kayıtlı" });

    const savedData = verificationData.get(email);
    if (!savedData)
      return res.status(400).json({ error: "Kullanıcı verisi bulunamadı" });

    const code = generateVerificationCode();
    verificationData.set(email, {
      ...savedData,
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Kayıt Doğrulama Kodu",
      text: `Merhaba ${savedData.firstName} ${savedData.lastName},\nKayıt işleminizi tamamlamak için doğrulama kodunuz: ${code}\nBu kod 5 dakika geçerlidir.`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Yeni doğrulama kodu gönderildi" });
  } catch (err) {
    console.error("Error in /register/resend-code:", err);
    res.status(500).json({ error: "E-posta gönderilemedi" });
  }
};

module.exports.resetPasswordPost = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "E-posta gerekli" });
    }

    if (!email.endsWith("@itu.edu.tr")) {
      return res.status(400).json({
        error: "Sadece @itu.edu.tr uzantılı e-postalar kullanılabilir",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        error: "Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı",
      });
    }

    const resetToken = generateResetToken();
    resetTokens.set(resetToken, {
      email,
      expiresAt: Date.now() + 15 * 60 * 1000, // Token 15 minutes valid
    });

    const resetLink = `${req.protocol}://${req.get(
      "host"
    )}/account/reset-password/confirm?token=${resetToken}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Şifre Sıfırlama Talebi",
      text: `Merhaba ${user.firstName} ${user.lastName},\nŞifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:\n${resetLink}\nBu bağlantı 15 dakika boyunca geçerlidir.`,
    };

    await transporter.sendMail(mailOptions);

    await Log.create({
      action: "Şifre Sıfırlama Talebi",
      description: `${user.firstName} ${user.lastName} adlı kullanıcı (${user.email}) şifre sıfırlama talebinde bulundu.`,
      user: user.email,
      role: user.role || "student",
    });

    res.json({
      message: "Şifre sıfırlama bağlantısı e-posta adresinize gönderildi",
    });
  } catch (err) {
    console.error("Error in /reset-password:", err);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
};

module.exports.confirmResetPasswordPost = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !resetTokens.has(token)) {
      return res
        .status(400)
        .json({ error: "Geçersiz veya süresi dolmuş token." });
    }

    const resetData = resetTokens.get(token);
    if (Date.now() > resetData.expiresAt) {
      resetTokens.delete(token);
      return res.status(400).json({ error: "Token süresi doldu." });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Şifre en az 6 karakter olmalı." });
    }

    const user = await User.findOne({ email: resetData.email });
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    await Log.create({
      action: "Şifre Sıfırlama",
      description: `${user.firstName} ${user.lastName} adlı kullanıcı (${user.email}) şifresini sıfırladı.`,
      user: user.email,
      role: user.role || "student",
    });

    resetTokens.delete(token);
    res.json({
      message: "Şifreniz başarıyla sıfırlandı. Lütfen giriş yapın.",
      redirect: "/account/login",
    });
  } catch (err) {
    console.error("Error in /reset-password/confirm:", err);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
};

module.exports.logout = (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Çıkış yapıldı" });
};


