const express = require("express");
const router = express.Router();
const ctrlAccount = require("../controllers/accountController");
const { verifyToken, verifyAdminToken, verifyRestOwnerToken } = require('../middlewares/auth');

// GET ROUTERS
router.get("/login", ctrlAccount.login);
router.get("/register", ctrlAccount.register);
router.get("/register/verification", ctrlAccount.verification);
router.get("/reset-password", ctrlAccount.resetPassword);
router.get("/reset-password/confirm", ctrlAccount.confirmResetPassword);

// POST ROUTERS
router.post("/login", ctrlAccount.loginPost);
router.post("/register/sendcode", ctrlAccount.sendCode);
router.post("/register/verifycode", ctrlAccount.verifyCode);
router.post("/register/resendcode", ctrlAccount.resendCode);
router.post("/reset-password", ctrlAccount.resetPasswordPost);
router.post("/reset-password/confirm", ctrlAccount.confirmResetPasswordPost);
router.post("/user/usermain/logout", ctrlAccount.logout);

module.exports = router;