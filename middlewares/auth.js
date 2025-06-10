const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

  // Check if request is for an API route (e.g., /restaurant/logout)
  const isApiRoute =
    req.originalUrl.startsWith("/restaurant/") && req.method === "POST";

  if (!token) {
    console.warn("❌ Token eksik!");
    if (isApiRoute) {
      return res.status(401).json({ success: false, message: "Token eksik" });
    }
    return res.status(401).redirect("/account/login");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.uid) {
      console.warn("❌ [verifyToken] Token'da uid eksik");
      if (isApiRoute) {
        return res
          .status(401)
          .json({ success: false, message: "Geçersiz token: uid eksik" });
      }
      return res.status(403).redirect("/account/login");
    }
    req.user = { _id: decoded.uid, ...decoded };
    next();
  } catch (err) {
    console.error("❌ [verifyToken] JWT hatası:", err.message);
    if (isApiRoute) {
      return res
        .status(403)
        .json({ success: false, message: "Geçersiz token" });
    }
    return res.status(403).redirect("/account/login");
  }
};

const verifyAdminToken = (req, res, next) => {
  verifyToken(req, res, () => {
    if (!req.user || !req.user._id) {
      console.warn("⛔ [verifyAdminToken] Kullanıcı bulunamadı.");
      return res.status(401).redirect("/account/login");
    }
    if (req.user.role !== "admin") {
      console.warn("⛔ [verifyAdminToken] Admin yetkisi yok:", req.user.role);
      return res.status(403).redirect("/account/login");
    }
    console.log("✅ [verifyAdminToken] Admin erişimi onaylandı:", req.user);
    next();
  });
};

const verifyRestOwnerToken = (req, res, next) => {
  console.log("📥 [verifyRestOwnerToken] Giriş yapıldı");
  console.log("📌 URL:", req.originalUrl);
  console.log("📌 Method:", req.method);
  console.log("📌 Cookie Token:", req.cookies?.token);
  console.log("📌 Header Authorization:", req.headers.authorization);

  verifyToken(req, res, () => {
    const isApiRoute =
      req.originalUrl.startsWith("/restaurant/") && req.method === "POST";
    console.log("🔎 [verifyRestOwnerToken] isApiRoute:", isApiRoute);
    console.log("🔐 [verifyRestOwnerToken] req.user:", req.user);

    if (!req.user || !req.user._id) {
      console.warn("⛔ [verifyRestOwnerToken] Kullanıcı bulunamadı.");
      if (isApiRoute) {
        return res
          .status(401)
          .json({ success: false, message: "Kullanıcı bulunamadı" });
      }
      return res.status(401).redirect("/account/login");
    }

    if (req.user.role !== "rest_owner") {
      console.warn(
        "⛔ [verifyRestOwnerToken] Restoran yetkisi yok. Kullanıcı rolü:",
        req.user.role
      );
      if (isApiRoute) {
        return res
          .status(403)
          .json({ success: false, message: "Restoran sahibi yetkisi gerekli" });
      }
      return res.status(403).redirect("/account/login");
    }

    console.log("✅ [verifyRestOwnerToken] Restoran erişimi onaylandı:", {
      userId: req.user._id,
      email: req.user.email,
      role: req.user.role,
    });
    next();
  });
};


module.exports = {
  verifyToken,
  verifyAdminToken,
  verifyRestOwnerToken,
};
