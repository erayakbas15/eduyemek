const express = require('express');
const router = express.Router();
const ctrlRestaurant = require('../controllers/restaurantController');
const upload = require('../middlewares/multer');
const { verifyToken, verifyAdminToken, verifyRestOwnerToken } = require('../middlewares/auth');

// === Sayfa Görüntüleme Route'ları ===
router.get('/dashboard', verifyRestOwnerToken, ctrlRestaurant.getRestaurantDashboard);
router.get('/rest_orders', verifyRestOwnerToken, ctrlRestaurant.getRestaurantOrdersPage);
router.get('/rest_menu', verifyRestOwnerToken, ctrlRestaurant.getRestaurantMenuPage);
router.get('/rest_comments', verifyRestOwnerToken, ctrlRestaurant.getRestaurantCommentsPage);
router.get('/rest_reports', verifyRestOwnerToken, ctrlRestaurant.getRestaurantReportsPage);
router.get('/rest_info', verifyRestOwnerToken, ctrlRestaurant.getRestaurantInfoPage);
router.get('/rest_settings', verifyRestOwnerToken, ctrlRestaurant.getRestaurantSettingsPage);

// === Veritabanı İşlemleri ===

// Yeni sipariş oluşturma
router.post('/new-order', verifyRestOwnerToken, ctrlRestaurant.createOrder);

// Restoran bilgilerini güncelleme
router.post('/update-info', verifyRestOwnerToken, upload.single('image'), ctrlRestaurant.updateRestaurantInfo);

// Restoran ayarlarını güncelleme
router.post('/update_settings', verifyRestOwnerToken, ctrlRestaurant.updateRestaurantSettings);

// Yeni yemek ekleme
router.post('/meal/add', verifyRestOwnerToken, upload.single('image'), ctrlRestaurant.addMeal);

// Yemek bilgilerini güncelleme
router.post('/meal/edit/:mealId', verifyRestOwnerToken, upload.single('image'), ctrlRestaurant.updateMeal);

// Yemek silme
router.post('/meal/delete/:mealId', verifyRestOwnerToken, ctrlRestaurant.deleteMeal);

// Sipariş durumunu güncelleme
router.post('/update-order-status/:orderId', verifyRestOwnerToken, ctrlRestaurant.updateOrderStatus);

// API: Menü verisini JSON olarak çekme
router.get('/my-menu', verifyRestOwnerToken, ctrlRestaurant.getRestaurantMenu);

// Yemek durumunu değiştirme
router.post('/meal/toggle/:mealId', verifyRestOwnerToken, ctrlRestaurant.toggleMealAvailability);

// Restoran durumunu değiştirme
router.post('/toggle-status', verifyRestOwnerToken, ctrlRestaurant.toggleRestaurantStatus);

// Restoran çıkışı
router.post('/logout', verifyRestOwnerToken, ctrlRestaurant.restaurantLogout);

// Yorum yanıtlama
router.post('/reply-comment', verifyRestOwnerToken, ctrlRestaurant.replyComment);

module.exports = router;