const express = require('express')
var router = express.Router()
var ctrlMain = require('../controllers/mainController')
const { verifyToken, verifyAdminToken, verifyRestOwnerToken } = require('../middlewares/auth');
const multer = require('multer');
const upload = multer();

router.get('/', ctrlMain.main)
router.get('/faq', ctrlMain.faq)
router.get('/user/usermain', verifyToken, ctrlMain.userMain)
router.get('/admin/adminmain', verifyAdminToken, ctrlMain.adminMain)
router.get('/user/usermain/account', verifyToken, ctrlMain.userMyAccount)
router.get('/user/usermain/orders', verifyToken, ctrlMain.userOrder)
router.get('/user/usermain/addresses', verifyToken, ctrlMain.userAddresses)
router.get('/user/usermain/userinfo', verifyToken, ctrlMain.userInfo)

router.get('/user/usermain/restaurant/:id', verifyToken, ctrlMain.restMenu)
router.get('/usermain/restaurants', verifyToken, ctrlMain.getRestaurants)
router.get('/api/user/usermain/restaurant/:id', verifyToken, ctrlMain.getRestaurantMealsJson)

router.post('/user/usermain/userinfo', verifyToken, ctrlMain.userInfoPost)
router.post('/user/usermain/changepassword', verifyToken, ctrlMain.changePassword);
router.post('/user/usermain/saveaddress', verifyToken, ctrlMain.saveAddress)
router.post('/user/usermain/deleteaddress', verifyToken, ctrlMain.deleteAddress)
router.post('/user/usermain/editaddress', verifyToken, ctrlMain.editAddress)
router.post('/user/usermain/selectaddress', verifyToken, ctrlMain.selectAddress);
router.post('/basket/add', verifyToken, ctrlMain.addToBasket)
router.post("/basket/update", verifyToken, ctrlMain.updateBasketItem);
router.post("/basket/remove", verifyToken, ctrlMain.removeFromBasket);
router.post("/basket/clear", verifyToken, ctrlMain.clearBasket);
router.post("/basket/saveordernote", verifyToken, ctrlMain.saveOrderNote);

router.get('/user/usermain/search', ctrlMain.search);

router.get('/basket/adds', verifyToken, ctrlMain.getBasket)

router.post('/user/order/comment', verifyToken, upload.none(), ctrlMain.submitComment);
router.post('/user/order/comment', verifyToken, ctrlMain.submitComment);

router.get('/user/usermain/checkout', verifyToken, ctrlMain.userCheckout);
router.post('/user/usermain/checkout', verifyToken, ctrlMain.confirmOrder);
router.post('/user/usermain/reorder', verifyToken, ctrlMain.reorderOrder);

router.get('/api/restaurant/:id', verifyToken, ctrlMain.getRestaurantInfo);

router.get('/user/usermain/nearbyrestaurants', verifyToken, ctrlMain.getNearbyRestaurants);

router.get('/user/usermain/validate-basket', verifyToken, ctrlMain.validateBasket);

router.get('/user/usermain/update-meal-stock', verifyToken, ctrlMain.updateMealStock);

// Yeni route: Restoran durumunu güncelleme
router.post('/restaurant/update-status', verifyRestOwnerToken, ctrlMain.updateRestaurantStatus);

module.exports = router;