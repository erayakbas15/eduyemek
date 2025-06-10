const User = require("../models/user_db");
const Basket = require("../models/basket_db");
const Address = require("../models/address_db");
const Restaurant = require("../models/restaurant_db");
const Order = require("../models/order_db");
const Meal = require("../models/meal_db");
const Comment = require("../models/comment_db");
const axios = require("axios");
const bcrypt = require("bcrypt");
const Log = require("../models/log_db");

function isRestaurantOpen(restaurant) {
  try {
    const now = new Date();
    const currentDay = now
      .toLocaleString("en-US", { weekday: "long" })
      .toLowerCase();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

    // Varsayılan değerler
    const openingHours = restaurant.openingHours || {
      daysOpen: {},
      open: "09:00",
      close: "21:00",
    };
    const daysOpen = openingHours.daysOpen || {};
    const openTime = openingHours.open || "09:00";
    const closeTime = openingHours.close || "21:00";
    const currentDbStatus = restaurant.delivery?.case || "open";

    // Gün kontrolü
    if (!daysOpen[currentDay]) {
      // If manually set to "open" in the database, respect it
      if (currentDbStatus === "open") {
        console.log(`Restaurant ${restaurant._id} is manually open despite closed day`);
        return true;
      }
      return false;
    }

    // Saat kontrolü
    if (currentTime < openTime || currentTime > closeTime) {
      // If manually set to "open" in the database, respect it
      if (currentDbStatus === "open") {
        console.log(`Restaurant ${restaurant._id} is manually open despite out-of-hours`);
        return true;
      }
      return false;
    }

    // If within hours and day is open, respect database status unless it's explicitly "closed"
    if (currentDbStatus === "closed") {
      console.log(`Restaurant ${restaurant._id} is manually closed despite being within hours`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `isRestaurantOpen error for restaurant ${restaurant._id}:`,
      error
    );
    return false; // Hata durumunda restoranı kapalı kabul et
  }
}

// ITÜ Ayazağa Campus circular boundary
const ITU_CAMPUS_CENTER = {
  lat: 41.10288648489622,
  lng: 29.02624331105179,
};
const ITU_CAMPUS_RADIUS_KM = 1.3;

// Helper function to calculate Haversine distance (in kilometers)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper function to check if coordinates are within ITÜ campus circular boundary
function isWithinCampus(lat, lng) {
  const distance = haversineDistance(
    ITU_CAMPUS_CENTER.lat,
    ITU_CAMPUS_CENTER.lng,
    lat,
    lng
  );
  return distance <= ITU_CAMPUS_RADIUS_KM;
}

// Kullanıcıya göre restoranları mesafe ile birlikte getir
module.exports.getNearbyRestaurants = async (req, res) => {
  try {
    const userId = req.user.uid;
    const user = await User.findById(userId).select("selectedAddressId");
    let userAddress = null;

    if (user && user.selectedAddressId) {
      userAddress = await Address.findById(user.selectedAddressId).select(
        "coordinates"
      );
    }

    const restaurants = await Restaurant.find({ status: "active" });

    const enrichedRestaurants = restaurants.map((restaurant) => {
      const r = restaurant.toObject();
      // Restoran açık mı kontrol et
      r.delivery = r.delivery || {};
      r.delivery.case = isRestaurantOpen(restaurant) ? "open" : "closed";

      if (
        userAddress &&
        userAddress.coordinates &&
        userAddress.coordinates.lat &&
        userAddress.coordinates.lng &&
        restaurant.location?.lat &&
        restaurant.location?.lng
      ) {
        const distance = haversineDistance(
          userAddress.coordinates.lat,
          userAddress.coordinates.lng,
          restaurant.location.lat,
          restaurant.location.lng
        );
        r.distance = distance.toFixed(2);
      } else {
        r.distance = null;
      }
      return r;
    });

    // Sadece açık restoranları göster (isteğe bağlı)
    const openRestaurants = enrichedRestaurants.filter(
      (r) => r.delivery.case === "open"
    );
    openRestaurants.sort(
      (a, b) => (a.distance || Infinity) - (b.distance || Infinity)
    );

    if (req.headers.accept.includes("application/json")) {
      if (!userAddress || !userAddress.coordinates) {
        return res.status(400).json({ error: "Adres bilgisi eksik" });
      }
      return res.json(openRestaurants);
    }

    res.render("user/restaurants", {
      title: "Restoranlar",
      restaurants: openRestaurants,
    });
  } catch (error) {
    console.error("Yakın restoranları getirirken hata:", error);
    res.status(500).json({ error: "Restoranlar yüklenemedi" });
  }
};

// Helper function to get cart count (assuming it's defined elsewhere in your file)
async function getCartCount(userId) {
  try {
    const basket = await Basket.findOne({ uid: userId }).lean();
    if (!basket) {
      return 0;
    }
    if (!basket.items || basket.items.length === 0) {
      return 0;
    }
    const count = basket.items.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0
    );
    return count;
  } catch (error) {
    console.error(`[getCartCount] Error: ${error.message}`);
    return 0;
  }
}

// GET METHODS

module.exports.main = function (req, res) {
  res.render("main.ejs");
};

module.exports.faq = function (req, res) {
  res.render("faq.ejs");
};

module.exports.adminMain = function (req, res) {
  res.render("./admin/admin_main.ejs");
};

module.exports.userMyAccount = async function (req, res) {
  let user = null;
  let cartCount = 0;
  let addresses = [];
  let activeOrderCount = 0;
  let errorMessage = null;

  try {
    // Check if the user is authenticated
    if (req.user && req.user.uid) {
      // Fetch user data
      user = await User.findById(req.user.uid).select("-password -__v");
      if (!user) {
        errorMessage =
          "Kullanıcı bulunamadı. Lütfen tekrar giriş yapmayı deneyin.";
      } else {
        // Fetch cart count
        cartCount = await getCartCount(req.user.uid);

        // Fetch addresses
        addresses = await Address.find({ uid: req.user.uid }).sort({
          createdAt: -1,
        });

        // Fetch active order count (e.g., orders with status 'pending' or 'in-progress')
        activeOrderCount = await Order.countDocuments({
          userId: req.user.uid,
          status: { $in: ["pending", "in-progress"] },
        });
      }
    } else {
      errorMessage = "Kullanıcı oturumu bulunamadı. Lütfen giriş yapın.";
    }

    // Render the account.ejs template with all dynamic data
    res.render("./user/account.ejs", {
      user: user,
      cartCount: cartCount,
      addresses: addresses,
      activeOrderCount: activeOrderCount,
      error: errorMessage,
      success: null,
    });
  } catch (error) {
    console.error("Error fetching user account details:", error);
    res.status(500).render("./user/account.ejs", {
      user: null,
      cartCount: 0,
      addresses: [],
      activeOrderCount: 0,
      error: "Hesap bilgileri yüklenirken beklenmeyen bir hata oluştu.",
      success: null,
    });
  }
};

module.exports.userOrder = async (req, res) => {
  let orders = [];
  let user = null;
  let addresses = [];
  let basket = null; // Initialize basket to null
  let cartCount = 0; // Initialize cartCount
  let errorMessage = null; // To store error messages

  try {
    // Prioritize req.user.uid for consistency with Basket and Address models
    const userId = req.user ? req.user.uid : null;

    if (!userId) {
      errorMessage = "Kullanıcı oturumu bulunamadı. Lütfen giriş yapın.";
      // If no user ID, no need to fetch data, just render with default values
    } else {
      // Fetch orders for the logged-in user
      orders = await Order.find({ userId: userId })
        .populate("restaurantId", "name address image") // Using 'address' as updated
        .populate("deliveryAddress", "title address formatted_address")
        .sort({ orderNumber: -1 });

      // Fetch user details (e.g., selectedAddressId)
      user = await User.findById(userId).select("selectedAddressId");

      // Fetch user's addresses
      addresses = await Address.find({ uid: userId }).sort({
        createdAt: -1,
      });

      // Fetch the basket for the current user
      basket = await Basket.findOne({ uid: userId });

      // Calculate cart count using the fetched basket
      cartCount = await getCartCount(userId);
    }

    // Always render orders.ejs, passing the collected data and any error message
    res.render("./user/orders.ejs", {
      orders: orders,
      user: user,
      addresses: addresses,
      basket: basket, // This will be null if not logged in or an error occurs
      error: errorMessage, // Pass the error message
      success: null, // You can set this if you have success messages
      cartCount: cartCount, // Pass the calculated cartCount
    });
  } catch (error) {
    console.error("Error fetching orders:", error.message, error.stack);
    // If a server error occurs, render orders.ejs with default/empty values
    res.status(500).render("./user/orders.ejs", {
      orders: [],
      user: null,
      addresses: [],
      basket: null,
      error: `Siparişler yüklenemedi: ${error.message}`, // Detailed error message
      success: null,
      cartCount: 0, // Ensure cartCount is 0 on server error
    });
  }
};

module.exports.userAddresses = async (req, res) => {
  let addresses = [];
  let user = null;
  let selectedAddress = null; // Added variable for selectedAddress
  let cartCount = 0;
  let errorMessage = null;

  try {
    const userId = req.user ? req.user.uid : null; // Get userId consistently

    if (!userId) {
      errorMessage = "Kullanıcı oturumu bulunamadı. Lütfen giriş yapın.";
      // If no user ID, addresses and user will remain empty/null
    } else {
      // Fetch addresses for the logged-in user
      addresses = await Address.find({ uid: userId }).sort({
        createdAt: -1,
      });

      // Fetch user details for selectedAddressId
      user = await User.findById(userId).select("selectedAddressId");

      // Fetch the selected address if selectedAddressId exists
      if (user && user.selectedAddressId) {
        selectedAddress = await Address.findOne({
          _id: user.selectedAddressId,
          uid: userId,
        });
      }

      // Calculate cartCount using the helper function
      cartCount = await getCartCount(userId);
    }

    // Check if the request expects JSON (e.g., from an AJAX call)
    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      // For JSON responses, include cartCount and any error message
      return res.status(errorMessage ? 500 : 200).json({
        addresses: addresses,
        selectedAddressId: user ? user.selectedAddressId : null,
        cartCount: cartCount,
        error: errorMessage,
      });
    }

    // For regular page renders (EJS)
    res.render("./user/addresses.ejs", {
      addresses: addresses,
      user: user,
      selectedAddress: selectedAddress, // Pass the selectedAddress to the template
      cartCount: cartCount,
      error: errorMessage, // Pass the error message to the template
      success: null, // You can add success messages if needed
    });
  } catch (error) {
    console.error("Adresler getirilemedi:", error);

    // If a server error occurs, handle differently for JSON vs EJS
    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(500).json({
        error: "Adresler getirilirken beklenmeyen bir hata oluştu.",
        cartCount: 0, // Ensure cartCount is 0 on error for API
      });
    }

    // For EJS rendering on server error
    res.status(500).render("./user/addresses.ejs", {
      addresses: [],
      user: null,
      selectedAddress: null, // Ensure selectedAddress is null on error
      cartCount: 0, // Ensure cartCount is 0 on error for EJS
      error: `Adresler yüklenemedi: ${error.message}`, // Detailed error message
      success: null,
    });
  }
};

module.exports.selectAddress = async (req, res) => {
  const { addressId } = req.body;
  if (!addressId) {
    return res.status(400).json({ error: "Adres ID gerekli" });
  }

  try {
    const address = await Address.findOne({
      _id: addressId,
      uid: req.user.uid,
    });
    if (!address) {
      return res.status(404).json({ error: "Adres bulunamadı" });
    }

    const user = await User.findById(req.user.uid);
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    user.selectedAddressId = addressId;
    await user.save();

    console.log(
      `[selectAddress] User ${user.email} selected address: ${address.title}`
    );
    res.json({ message: "Adres başarıyla seçildi" });
  } catch (error) {
    console.error("Adres seçme hatası:", error);
    res.status(500).json({ error: "Adres seçilirken hata oluştu" });
  }
};

module.exports.restMenu = async (req, res) => {
  try {
    // Fetch basket data to get cart count
    const basket = await Basket.findOne({ uid: req.user.uid });
    const cartCount = basket
      ? basket.items.reduce((sum, item) => sum + item.quantity, 0)
      : 0;

    // Fetch restaurant and meals
    const restaurantId = req.params.id;
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }
    const meals = await Meal.find({ restaurantId }).select(
      "name description price"
    );

    // Render the template with cartCount included
    res.render("./user/rest_menu.ejs", { restaurant, meals, cartCount });
  } catch (err) {
    console.error("Error fetching restaurant menu:", err);
    res.status(500).render("error", { message: "Menü yüklenemedi" });
  }
};


module.exports.getRestaurants = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { filter = 'all', page = 1, limit = 10 } = req.query;
    let selectedAddress = null;

    if (userId) {
      const user = await User.findById(userId).select("selectedAddressId");
      if (user && user.selectedAddressId) {
        selectedAddress = await Address.findById(user.selectedAddressId).select("coordinates");
      }
    }

    // Build query based on filter
    let query = { status: "active" };

    // Get total count before pagination
    const totalRestaurants = await Restaurant.countDocuments(query);

    let restaurants = await Restaurant.find(query)
      .select("name description delivery openingHours imageUrl address location rating")
      .lean()
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    restaurants = restaurants.map((restaurant) => {
      let distance = null;
      if (selectedAddress && selectedAddress.coordinates && restaurant.location) {
        distance = haversineDistance(
          selectedAddress.coordinates.lat,
          selectedAddress.coordinates.lng,
          restaurant.location.lat,
          restaurant.location.lng
        );
        distance = Number(distance.toFixed(2));
      }

      const isOpen = isRestaurantOpen(restaurant);
      const restaurantData = {
        _id: restaurant._id,
        name: restaurant.name || "İsimsiz Restoran",
        description: restaurant.description || "Henüz açıklama yok.",
        delivery: {
          case: isOpen ? "open" : "closed",
          minOrderAmount: restaurant.delivery?.minOrderAmount || 0,
          estimatedTime: restaurant.delivery?.estimatedTime || "Bilinmiyor",
        },
        openingHours: {
          open: restaurant.openingHours?.open || "09:00",
          close: restaurant.openingHours?.close || "21:00",
          daysOpen: restaurant.openingHours?.daysOpen || {},
        },
        imageUrl: restaurant.imageUrl || null,
        rating: {
          average: restaurant.rating?.average || 0,
          count: restaurant.rating?.count || 0,
        },
        distance: distance || null,
      };

      return restaurantData;
    });

    // Apply filter after mapping if needed
    if (filter === 'open') {
      restaurants = restaurants.filter(r => r.delivery.case === 'open');
    } else if (filter === 'closed') {
      restaurants = restaurants.filter(r => r.delivery.case === 'closed');
    }

    res.json({
      restaurants,
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalRestaurants, // Return total count of matching restaurants
    });
  } catch (err) {
    console.error("Restoranlar alınamadı:", err);
    res.status(500).json({ error: "Restoranlar getirilemedi" });
  }
};

module.exports.getRestaurantMealsJson = async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const meals = await Meal.find({ restaurantId }).select(
      "name description price category available imageUrl"
    );

    if (!meals || meals.length === 0) {
      return res.status(404).json({ error: "Yemekler bulunamadı" });
    }

    res.json(meals);
  } catch (err) {
    console.error("API - Menü çekme hatası:", err);
    res.status(500).json({ error: "Menü yüklenemedi" });
  }
};

module.exports.userInfo = async (req, res) => {
  let user = null;
  let cartCount = 0;
  let errorMessage = null;

  try {
    const userId = req.user ? req.user.uid : null; // Consistent user ID access

    if (!userId) {
      errorMessage = "Kullanıcı oturumu bulunamadı. Lütfen giriş yapın.";
    } else {
      user = await User.findById(userId).select("-password -__v");

      if (!user) {
        errorMessage = "Kullanıcı bilgileri veritabanında bulunamadı.";
      }

      // Calculate cartCount using the helper function
      cartCount = await getCartCount(userId);
    }

    // Always render user_info.ejs, passing all necessary data and error message
    res.render("./user/user_info.ejs", {
      user: user, // Will be null if user not found or not logged in
      cartCount: cartCount,
      error: errorMessage, // Pass the error message to the template
      success: null, // For potential future success messages
    });
  } catch (err) {
    console.error("Error in /userinfo:", err);
    // On a server-side error, render the page with a generic error message
    res.status(500).render("./user/user_info.ejs", {
      user: null, // No user data on server error
      cartCount: 0, // Default cartCount on error
      error: `Kullanıcı bilgileri yüklenirken bir hata oluştu: ${err.message}`,
      success: null,
    });
  }
};

module.exports.userMain = async (req, res) => {
  try {
    // Kullanıcı oturumunu kontrol et
    if (!req.user || !req.user.uid) {
      console.error("userMain: Kullanıcı oturumu bulunamadı");
      return res.status(401).render("error", { message: "Lütfen giriş yapın" });
    }

    console.log(`userMain: Processing for user ${req.user.uid}`);

    // Sepet bilgisi
    const basket = await Basket.findOne({ uid: req.user.uid });
    const cartCount = basket
      ? basket.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
      : 0;
    console.log(`userMain: Cart count for user ${req.user.uid}: ${cartCount}`);

    // Kullanıcı adres bilgisi
    const user = await User.findById(req.user.uid).select("selectedAddressId");
    if (!user) {
      console.error(`userMain: Kullanıcı bulunamadı, ID: ${req.user.uid}`);
      return res
        .status(404)
        .render("error", { message: "Kullanıcı bulunamadı" });
    }
    console.log(
      `userMain: User found: ${user._id}, selectedAddressId: ${user.selectedAddressId}`
    );

    let userAddress = null;
    if (user.selectedAddressId) {
      userAddress = await Address.findById(user.selectedAddressId).select(
        "coordinates"
      );
      if (!userAddress) {
        console.warn(
          `userMain: Seçili adres bulunamadı, addressId: ${user.selectedAddressId}`
        );
      } else {
        console.log(
          `userMain: User address coordinates: ${JSON.stringify(
            userAddress.coordinates
          )}`
        );
      }
    }

    // Filter parametresini al
    const filter = req.query.filter || 'all'; // Varsayılan olarak 'all'

    // Restoranları çek
    let restaurants = await Restaurant.find()
      .select("name description delivery openingHours imageUrl location rating")
      .lean();
    console.log(`userMain: Found ${restaurants.length} restaurants`);

    let enrichedRestaurants = restaurants.map((restaurant) => {
      let distance = null;
      if (
        userAddress &&
        userAddress.coordinates &&
        userAddress.coordinates.lat &&
        userAddress.coordinates.lng &&
        restaurant.location &&
        restaurant.location.lat &&
        restaurant.location.lng
      ) {
        distance = haversineDistance(
          userAddress.coordinates.lat,
          userAddress.coordinates.lng,
          restaurant.location.lat,
          restaurant.location.lng
        );
        console.log(
          `userMain: Distance for restaurant ${
            restaurant._id
          }: ${distance.toFixed(2)} km`
        );
      }

      console.log(
        `userMain: Restaurant ${restaurant._id} is ${
          isRestaurantOpen(restaurant) ? "open" : "closed"
        }`
      );

      return {
        ...restaurant,
        delivery: {
          case: isRestaurantOpen(restaurant) ? "open" : "closed",
          minOrderAmount: restaurant.delivery?.minOrderAmount || 0,
          estimatedTime: restaurant.delivery?.estimatedTime || "Bilinmiyor",
        },
        distance: distance ? parseFloat(distance.toFixed(2)) : null,
      };
    });

    // Filter uygula
    if (filter === 'open') {
      enrichedRestaurants = enrichedRestaurants.filter(r => r.delivery.case === 'open');
    } else if (filter === 'closed') {
      enrichedRestaurants = enrichedRestaurants.filter(r => r.delivery.case === 'closed');
    }

    enrichedRestaurants.sort(
      (a, b) => (a.distance || Infinity) - (b.distance || Infinity)
    );

    console.log(
      `userMain: Rendering user_main.ejs with ${enrichedRestaurants.length} restaurants`
    );
    res.render("./user/user_main.ejs", {
      cartCount,
      restaurants: enrichedRestaurants,
      filter,
    });
  } catch (error) {
    console.error("userMain: Error occurred:", error.message, error.stack);
    res
      .status(500)
      .render("error", { message: `Sayfa yüklenemedi: ${error.message}` });
  }
};

module.exports.search = async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Arama sorgusu gerekli" });
  }

  try {
    const restaurants = await Restaurant.find({
      name: { $regex: query, $options: "i" },
      "delivery.case": "open",
    }).select("name");

    const meals = await Meal.find({
      name: { $regex: query, $options: "i" },
    })
      .populate("restaurantId", "delivery name")
      .select("name restaurantId");

    console.log("Restaurants found:", restaurants); // Debug log
    console.log("Meals found:", meals); // Debug log

    const suggestions = [
      ...restaurants.map((r) => ({
        id: r._id,
        name: r.name,
        type: "restaurant",
      })),
      ...meals
        .filter(
          (m) => m.restaurantId && m.restaurantId.delivery?.case === "open"
        )
        .map((m) => ({
          id: m._id,
          name: m.name,
          type: "meal",
          restaurantId: m.restaurantId._id,
          restaurantName: m.restaurantId.name, // Include restaurant name
        })),
    ];

    console.log("Suggestions:", suggestions); // Debug log
    res.json(suggestions);
  } catch (error) {
    console.error("Arama hatası:", error);
    res.status(500).json({ error: "Arama yapılamadı" });
  }
};

// POST METHODS

module.exports.userInfoPost = async (req, res) => {
  const { firstName, lastName, phone } = req.body;

  if (
    (firstName && typeof firstName !== "string") ||
    (lastName && typeof lastName !== "string") ||
    (phone && typeof phone !== "string")
  ) {
    return res.status(400).json({ error: "Geçersiz veri formatı" });
  }

  try {
    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı" });

    user.firstName = firstName ?? user.firstName;
    user.lastName = lastName ?? user.lastName;
    user.phone = phone ?? user.phone;
    await user.save();

    res.json({ message: "Bilgiler güncellendi" });
  } catch (err) {
    console.error("Error in /userinfo:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
};

module.exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.uid);
    if (!user) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı" });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mevcut şifre yanlış" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Şifre güncellendi" });
  } catch (err) {
    console.error("Error changing password:", err);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};

module.exports.saveAddress = async (req, res) => {
  const { title, address } = req.body;
  if (!title || !address) {
    return res.redirect(
      "/user/usermain/addresses?error=Adres başlığı ve adres gerekli"
    );
  }

  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: { address, key: process.env.GOOGLE_API_KEY },
      }
    );

    const data = response.data;
    if (data.status !== "OK" || data.results.length === 0) {
      return res.redirect(
        "/user/usermain/addresses?error=Adres bulunamadı veya geçersiz"
      );
    }

    const location = data.results[0].geometry.location;
    if (!isWithinCampus(location.lat, location.lng)) {
      return res.redirect(
        "/user/usermain/addresses?error=Adres ITÜ Ayazağa Kampüsü sınırları dışında"
      );
    }

    const newAddress = await Address.create({
      uid: req.user.uid,
      title,
      address,
      coordinates: { lat: location.lat, lng: location.lng },
      formatted_address: data.results[0].formatted_address,
    });

    const user = await User.findById(req.user.uid);
    if (!user) {
      return res.redirect(
        "/user/usermain/addresses?error=Kullanıcı bulunamadı"
      );
    }
    user.selectedAddressId = newAddress._id;
    await user.save();

    console.log(
      `[saveAddress] User ${user.email} saved new address: ${newAddress.title}`
    );
    res.redirect("/user/usermain/addresses?success=Adres başarıyla kaydedildi");
  } catch (error) {
    console.error("Adres kaydetme hatası:", error.message);
    res.redirect(
      "/user/usermain/addresses?error=Adres kaydetme sırasında hata oluştu"
    );
  }
};

module.exports.deleteAddress = async (req, res) => {
  const { addressId } = req.body;
  try {
    const address = await Address.findOneAndDelete({
      _id: addressId,
      uid: req.user.uid,
    });
    if (!address) {
      return res.redirect("/user/usermain/addresses?error=Adres bulunamadı");
    }
    res.redirect("/user/usermain/addresses?success=Adres başarıyla silindi");
  } catch (error) {
    console.error("Adres silme hatası:", error);
    res.redirect("/user/usermain/addresses?error=Adres silinirken hata oluştu");
  }
};

module.exports.editAddress = async (req, res) => {
  const { addressId, title, address } = req.body;

  if (!addressId || !title || !address) {
    return res.redirect("/user/usermain/addresses?error=Gerekli alanlar eksik");
  }

  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: { address, key: process.env.GOOGLE_API_KEY },
      }
    );

    const data = response.data;
    if (data.status !== "OK" || data.results.length === 0) {
      return res.redirect(
        "/user/usermain/addresses?error=Adres bulunamadı veya geçersiz"
      );
    }

    const location = data.results[0].geometry.location;
    if (!isWithinCampus(location.lat, location.lng)) {
      return res.redirect(
        "/user/usermain/addresses?error=Adres ITÜ Ayazağa Kampüsü dışında"
      );
    }

    const updatedAddress = await Address.findOneAndUpdate(
      { _id: addressId, uid: req.user.uid },
      {
        title,
        address,
        coordinates: { lat: location.lat, lng: location.lng },
        formatted_address: data.results[0].formatted_address,
      },
      { new: true }
    );

    if (!updatedAddress) {
      return res.redirect("/user/usermain/addresses?error=Adres bulunamadı");
    }

    console.log(
      `[editAddress] User ${req.user.uid} updated address: ${updatedAddress.title}`
    );
    res.redirect(
      "/user/usermain/addresses?success=Adres başarıyla güncellendi"
    );
  } catch (error) {
    console.error("Adres düzenleme hatası:", error);
    res.redirect(
      "/user/usermain/addresses?error=Adres düzenlenirken hata oluştu"
    );
  }
};

module.exports.addToBasket = async (req, res) => {
  const { mealId, name, price, quantity = 1 } = req.body;

  // Validate inputs
  if (!mealId) {
    return res.status(400).json({ error: "Ürün ID gerekli" });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Ürün adı gerekli ve string olmalı" });
  }
  if (!price || isNaN(price) || typeof price !== "number") {
    return res.status(400).json({ error: "Fiyat gerekli ve sayı olmalı" });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res
      .status(400)
      .json({ error: "Miktar pozitif bir tam sayı olmalı" });
  }

  try {
    const userId = req.user.uid;
    let basket = await Basket.findOne({ uid: userId });
    const meal = await Meal.findById(mealId).select("restaurantId");
    if (!meal) {
      return res.status(404).json({ error: "Ürün bulunamadı" });
    }

    // Restoran adını al
    const restaurant = await Restaurant.findById(meal.restaurantId).select(
      "name"
    );
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    // Sepet yoksa yeni oluştur ve restaurantId ile restaurantName'yi ekle
    if (!basket) {
      basket = new Basket({
        uid: userId,
        restaurantId: meal.restaurantId,
        restaurantName: restaurant.name,
        items: [],
        totalPrice: 0,
      });
    }

    // Sepetteki restoran ID'sini kontrol et
    if (
      basket.items.length > 0 &&
      basket.restaurantId.toString() !== meal.restaurantId.toString()
    ) {
      return res.status(400).json({
        error: "Sepete yalnızca tek bir restorandan ürün ekleyebilirsiniz!",
      });
    }

    // restaurantId ve restaurantName'yi güncelle (ilk ürün ekleniyorsa)
    if (basket.items.length === 0) {
      basket.restaurantId = meal.restaurantId;
      basket.restaurantName = restaurant.name;
    }

    const existingItem = basket.items.find(
      (item) => item.mealId.toString() === mealId.toString()
    );
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      basket.items.push({ mealId, name, quantity, price });
    }

    await basket.save();
    res.json({ message: "Ürün sepete eklendi", basket });
  } catch (error) {
    console.error("Basket save error:", error);
    res.status(500).json({ error: "Sepet kaydedilirken hata oluştu" });
  }
};

module.exports.updateBasketItem = async (req, res) => {
  try {
    const { mealId, action } = req.body;
    const basket = await Basket.findOne({ uid: req.user.uid });

    console.log(
      "Basket items:",
      basket.items.map((item) => ({ mealId: item.mealId, name: item.name }))
    );

    if (!basket) {
      return res.json({ success: false, message: "Sepet bulunamadı" });
    }

    const itemIndex = basket.items.findIndex(
      (item) => item.mealId.toString() === mealId
    );

    if (itemIndex === -1) {
      return res.json({ success: false, message: "Ürün sepette bulunamadı" });
    }

    if (action === "increase") {
      basket.items[itemIndex].quantity += 1;
    } else if (action === "decrease") {
      if (basket.items[itemIndex].quantity > 1) {
        basket.items[itemIndex].quantity -= 1;
      } else {
        // Miktar 1'e düştüğünde ürünü sepetten kaldır
        basket.items.splice(itemIndex, 1);
      }
    }

    if (basket.items.length === 0) {
      basket.totalPrice = 0;
      basket.note = "";
      basket.restaurantId = null;
      basket.restaurantName = null;
    }

    await basket.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Update basket error:", error);
    res.json({ success: false, message: "Bir hata oluştu" });
  }
};

module.exports.removeFromBasket = async (req, res) => {
  try {
    const { mealId } = req.body;
    const basket = await Basket.findOne({ uid: req.user.uid });

    if (!basket) {
      return res.json({ success: false, message: "Sepet bulunamadı" });
    }

    const itemIndex = basket.items.findIndex(
      (item) => item.mealId.toString() === mealId
    );

    if (itemIndex === -1) {
      return res.json({ success: false, message: "Ürün sepette bulunamadı" });
    }

    // Ürünü sepetten tamamen kaldır
    basket.items.splice(itemIndex, 1);

    if (basket.items.length === 0) {
      basket.totalPrice = 0;
      basket.note = "";
      basket.restaurantId = null;
      basket.restaurantName = null;
    }

    await basket.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Remove from basket error:", error);
    res.json({ success: false, message: "Bir hata oluştu" });
  }
};

module.exports.clearBasket = async (req, res) => {
  try {
    const userId = req.user.uid;
    const basket = await Basket.findOne({ uid: userId });

    if (!basket) {
      return res.status(404).json({ error: "Sepet bulunamadı" });
    }

    // Sepeti sıfırla
    basket.items = [];
    basket.totalPrice = 0;
    basket.restaurantId = null;
    basket.restaurantName = null;
    basket.note = "";

    await basket.save();
    res.json({ success: true, message: "Sepet başarıyla temizlendi" });
  } catch (error) {
    console.error("Clear basket error:", error);
    res.status(500).json({ error: "Sepet temizlenirken hata oluştu" });
  }
};

module.exports.saveOrderNote = async (req, res) => {
  try {
    const { note } = req.body;
    if (typeof note !== "string") {
      return res.status(400).json({ error: "Not bir string olmalı" });
    }

    const basket = await Basket.findOne({ uid: req.user.uid });
    if (!basket) {
      return res.json({ success: false, message: "Sepet bulunamadı" });
    }

    basket.note = note;
    await basket.save();
    res.json({ success: true, message: "Not başarıyla kaydedildi" });
  } catch (error) {
    console.error("Save order note error:", error);
    res.json({ success: false, message: "Not kaydedilirken hata oluştu" });
  }
};

module.exports.getBasket = async (req, res) => {
  try {
    const userId = req.user.uid;
    const basket = await Basket.findOne({ uid: userId }).populate(
      "items.mealId",
      "name price image"
    );

    if (!basket || !basket.items || basket.items.length === 0) {
      return res.json({ basket: null });
    }

    // Sepet istatistikleri
    const itemCount = basket.items.length;
    const totalQuantity = basket.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const totalPrice = basket.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Restaurant adı ve sipariş notu
    const restaurantName = basket.restaurantName || "Bilinmeyen Restoran";
    const note = basket.note || "";

    // JSON yapısını frontend'in beklediği forma getir
    const formattedItems = basket.items.map((item) => ({
      mealId: item.mealId._id,
      name: item.mealId.name,
      price: item.mealId.price,
      quantity: item.quantity,
      image: item.mealId.image || null,
    }));

    res.json({
      basket: {
        items: formattedItems,
        itemCount,
        totalQuantity,
        totalPrice,
        restaurantName,
        note,
      },
    });
  } catch (error) {
    console.error("Basket fetch error:", error);
    res.status(500).json({ error: "Sepet getirilirken hata oluştu" });
  }
};

// Route to render comment page
module.exports.commentOrder = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (!orderId) {
      return res.redirect("/user/usermain/orders?error=Order ID is required");
    }

    // Fetch the order from the database
    const order = await Order.findById(orderId)
      .populate("restaurantId", "name location image")
      .populate("deliveryAddress", "title address formatted_address")
      .lean();

    if (!order) {
      return res.redirect("/user/usermain/orders?error=Order not found");
    }

    // Check if the order belongs to the user
    if (order.userId.toString() !== req.user.uid.toString()) {
      return res.redirect("/user/usermain/orders?error=Unauthorized access");
    }

    // Check if the order is delivered
    if (order.status !== "delivered") {
      return res.redirect(
        "/user/usermain/orders?error=Only delivered orders can be commented"
      );
    }

    // Fetch cart count for consistent header rendering
    const cartCount = await getCartCount(req.user.uid);

    // Render comment.ejs with order details
    res.render("user/comment", {
      order,
      cartCount,
      error: null,
      success: null,
    });
  } catch (error) {
    console.error("Error fetching order for comment:", error);
    res.redirect("/user/usermain/orders?error=Failed to load comment page");
  }
};

module.exports.submitComment = async (req, res) => {
  try {
    const { orderId, rating, comment } = req.body;

    // Validate inputs
    if (!orderId || !rating || !comment) {
      return res.status(400).json({ error: "Puan ve yorum gereklidir" });
    }

    const parsedRating = parseInt(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: "Puan 1 ile 5 arasında olmalıdır" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Sipariş bulunamadı" });
    }

    if (order.userId.toString() !== req.user.uid.toString()) {
      return res.status(403).json({ error: "Yetkisiz erişim" });
    }

    if (order.status !== "delivered") {
      return res.status(400).json({
        error: "Yorum sadece teslim edilmiş siparişler için yapılabilir",
      });
    }

    // Save the comment
    const newComment = new Comment({
      restaurantId: order.restaurantId,
      userId: req.user.uid,
      rating: parsedRating,
      text: comment,
      createdAt: new Date(),
      orderId,
    });
    await newComment.save();

    // Update order's hasComment field
    await Order.findByIdAndUpdate(orderId, { hasComment: true });

    // Update restaurant's rating
    const restaurantId = order.restaurantId;
    const comments = await Comment.find({ restaurantId });
    const ratingCount = comments.length;
    const ratingSum = comments.reduce(
      (sum, comment) => sum + comment.rating,
      0
    );
    const ratingAverage =
      ratingCount > 0 ? (ratingSum / ratingCount).toFixed(2) : 0;

    await Restaurant.findByIdAndUpdate(
      restaurantId,
      {
        $set: {
          "rating.count": ratingCount,
          "rating.average": parseFloat(ratingAverage),
        },
      },
      { new: true }
    );

    // Log the comment action
    const user = await User.findById(req.user.uid).select(
      "firstName lastName email role"
    );
    const restaurant = await Restaurant.findById(restaurantId).select("name");
    await Log.create({
      action: "Yorum Yapıldı",
      actionType: "added",
      description: `${user.firstName} ${user.lastName} adlı kullanıcı, "${restaurant.name}" restoranına #${order.orderNumber} numaralı sipariş için yorum yaptı.`,
      user: user.email,
      role: user.role,
    });

    res.json({ success: true, message: "Yorum başarıyla gönderildi" });
  } catch (error) {
    console.error("Yorum gönderilirken hata:", error.message, error.stack);
    res.status(500).json({ error: "Yorum gönderilirken hata oluştu" });
  }
};

exports.userCheckout = async (req, res) => {
  try {
    const userId = req.user.uid;
    const basket = await Basket.findOne({ uid: userId }).populate(
      "items.mealId"
    );
    const cartCount = await getCartCount(userId);
    const user = await User.findById(userId).select(
      "selectedAddressId phone firstName lastName"
    );

    if (
      !user.phone ||
      typeof user.phone !== "string" ||
      user.phone.trim() === ""
    ) {
      return res.redirect(
        "/user/usermain/userinfo?error=Telefon numaranızı kaydetmelisiniz"
      );
    }

    let address = null;
    if (user.selectedAddressId) {
      address = await Address.findById(user.selectedAddressId);
      if (!address) {
        return res.redirect(
          "/user/usermain/addresses?error=Seçili adres bulunamadı"
        );
      }
    } else {
      return res.redirect(
        "/user/usermain/addresses?error=Lütfen bir teslimat adresi seçin"
      );
    }

    if (!basket || basket.items.length === 0) {
      return res.redirect("/user/usermain/basket?error=Sepet boş");
    }

    // Restoran durumunu kontrol et
    const restaurant = await Restaurant.findById(basket.restaurantId).select(
      "delivery"
    );
    if (!restaurant) {
      return res.redirect("/user/usermain/basket?error=Restoran bulunamadı");
    }
    if (restaurant.delivery.case === "closed") {
      return res.redirect("/user/usermain?error=Restoran şu anda kapalı");
    }

    // Stok kontrolü
    const outOfStockItems = [];
    for (const item of basket.items) {
      const meal = await Meal.findById(item.mealId._id);
      if (!meal) {
        outOfStockItems.push({
          name: item.mealId.name,
          issue: "Ürün bulunamadı",
        });
      } else if (meal.stock === 0) {
        outOfStockItems.push({
          name: item.mealId.name,
          issue: "Stokta kalmadı",
        });
      } else if (item.quantity > meal.stock) {
        outOfStockItems.push({
          name: item.mealId.name,
          issue: `Yetersiz stok. Mevcut stok: ${meal.stock}`,
        });
      }
    }

    if (outOfStockItems.length > 0) {
      return res.render("user/checkout", {
        title: "Ödeme Sayfası",
        user,
        basket,
        cartCount,
        address,
        order: null,
        paymentMethods: [],
        error: `Aşağıdaki ürünlerde sorun var: ${outOfStockItems
          .map((i) => `${i.name} - ${i.issue}`)
          .join(", ")}. Lütfen sepetinizi güncelleyin.`,
      });
    }

    const orderSummary = {
      itemsCount: basket.items.length,
      subtotal: basket.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2),
      shippingFee: "0.00",
      total: basket.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2),
      items: basket.items.map((item) => ({
        mealId: item.mealId._id,
        name: item.mealId.name,
        quantity: item.quantity,
        price: item.price,
        totalPrice: (item.price * item.quantity).toFixed(2),
      })),
    };

    const paymentMethods = [
      { value: "credit_card", label: "Kredi Kartı" },
      { value: "cash", label: "Nakit" },
      { value: "online_payment", label: "Online Ödeme" },
      { value: "wallet", label: "Cüzdan" },
    ];

    res.render("user/checkout", {
      title: "Ödeme Sayfası",
      user,
      basket,
      cartCount,
      address,
      order: orderSummary,
      paymentMethods,
      error: null,
    });
  } catch (error) {
    console.error("Checkout sayfasını yüklerken hata:", error);
    res.status(500).render("user/checkout", {
      title: "Ödeme Sayfası",
      user: req.user,
      basket: null,
      cartCount: 0,
      address: null,
      order: null,
      paymentMethods: [],
      error: "Checkout sayfası yüklenirken bir hata oluştu",
    });
  }
};

module.exports.confirmOrder = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { note, paymentMethod } = req.body;

    // Ödeme yöntemi doğrulama
    const validPaymentMethods = [
      "credit_card",
      "cash",
      "online_payment",
      "wallet",
    ];
    if (!paymentMethod || !validPaymentMethods.includes(paymentMethod)) {
      return res
        .status(400)
        .json({ success: false, error: "Geçerli bir ödeme yöntemi seçin" });
    }

    const user = await User.findById(userId).select("selectedAddressId phone");
    const basket = await Basket.findOne({ uid: userId }).populate(
      "items.mealId"
    );

    // Telefon numarası kontrolü
    if (!user.phone || user.phone.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Sipariş verebilmek için telefon numaranızı kaydetmelisiniz",
      });
    }

    // Sepet kontrolü
    if (!basket || basket.items.length === 0) {
      return res.status(400).json({ success: false, error: "Sepet boş" });
    }

    // Adres kontrolü
    if (!user.selectedAddressId) {
      return res
        .status(400)
        .json({ success: false, error: "Lütfen bir teslimat adresi seçin" });
    }
    const address = await Address.findById(user.selectedAddressId);
    if (!address) {
      return res
        .status(400)
        .json({ success: false, error: "Seçili adres bulunamadı" });
    }

    // Restoran bilgilerini çek
    const restaurant = await Restaurant.findById(basket.restaurantId).select(
      "delivery"
    );
    if (!restaurant) {
      return res.status(400).json({
        success: false,
        error: "Restoran bulunamadı",
      });
    }

    // Restoran durumunu kontrol et
    if (restaurant.delivery.case === "closed") {
      return res.status(400).json({
        success: false,
        error: "Restoran şu anda kapalı",
      });
    }

    // Sepet toplamını hesapla
    const subtotal = basket.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Minimum sipariş tutarı kontrolü
    const minOrderAmount = restaurant.delivery?.minOrderAmount || 0;
    if (subtotal < minOrderAmount) {
      const remainingAmount = (minOrderAmount - subtotal).toFixed(2);
      return res.status(400).json({
        success: false,
        error: `Minimum Sipariş: ${minOrderAmount} TL. Minimum sipariş tutarını geçmek için sepetinize ${remainingAmount} TL değerinde ürün daha eklemeniz gerekmektedir.`,
      });
    }

    // Stok kontrolü
    for (const item of basket.items) {
      const meal = await Meal.findById(item.mealId._id);
      if (!meal) {
        return res.status(400).json({
          success: false,
          error: `${item.mealId.name} adlı ürün bulunamadı.`,
        });
      }
      if (meal.stock === 0) {
        return res.status(400).json({
          success: false,
          error: `${meal.name} adlı ürün stokta kalmadı.`,
        });
      }
      if (item.quantity > meal.stock) {
        return res.status(400).json({
          success: false,
          error: `${meal.name} adlı ürün için yeterli stok yok. Mevcut stok: ${meal.stock}`,
        });
      }
    }

    // Sipariş notunu sepete kaydet
    if (note) {
      basket.note = note;
      await basket.save();
    }

    // Sipariş oluştur
    const order = new Order({
      userId: userId,
      restaurantId: basket.restaurantId,
      items: basket.items.map((item) => ({
        mealId: item.mealId._id,
        name: item.mealId.name,
        price: item.price,
        quantity: item.quantity,
      })),
      deliveryAddress: address._id,
      deliveryAddressDetails: {
        formatted_address: address.formatted_address,
        title: address.title || "",
        address: address.address || "",
      },
      subtotal: subtotal,
      shippingFee: 0,
      total: subtotal,
      totalPrice: subtotal,
      note: basket.note || "",
      paymentMethod: paymentMethod,
      status: "pending",
      orderNumber: (await Order.countDocuments()) + 1,
    });

    await order.save();

    // Stok düşürme
    for (const item of basket.items) {
      const meal = await Meal.findById(item.mealId._id);
      meal.stock -= item.quantity;
      await meal.save();
    }

    // Sepeti temizle
    await Basket.findOneAndUpdate(
      { uid: userId },
      {
        items: [],
        totalPrice: 0,
        restaurantId: null,
        restaurantName: null,
        note: "",
      }
    );

    // Log kaydı oluştur
    const restaurantData = await Restaurant.findById(
      basket.restaurantId
    ).select("name");
    const userData = await User.findById(userId).select(
      "firstName lastName email role"
    );
    await Log.create({
      action: "Sipariş Oluşturuldu",
      actionType: "added",
      description: `${userData.firstName} ${userData.lastName} adlı kullanıcı, "${restaurantData.name}" restoranından #${order.orderNumber} numaralı sipariş oluşturdu. Ödeme yöntemi: ${paymentMethod}.`,
      user: userData.email,
      role: userData.role,
    });

    // Socket.IO ile newOrder olayı
    const io = req.app.get("io");
    io.to(basket.restaurantId.toString()).emit("newOrder", {
      orderId: order._id,
      status: order.status,
      userId: order.userId,
      items: order.items,
      totalPrice: order.totalPrice,
      createdAt: order.createdAt,
    });

    res.json({ success: true, message: "Sipariş başarıyla oluşturuldu" });
  } catch (error) {
    console.error("Sipariş oluşturma hatası:", error);
    res
      .status(500)
      .json({ success: false, error: "Sipariş oluşturulurken hata oluştu" });
  }
};

module.exports.getRestaurantInfo = async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Restoran bulunamadı" });
    }
    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ message: "Sunucu hatası", error });
  }
};

module.exports.reorderOrder = async (req, res) => {
  const { orderId } = req.body;
  console.log(
    `[reorderOrder] Processing reorder for orderId: ${orderId}, userId: ${req.user.uid}`
  );

  try {
    console.log(`[reorderOrder] Fetching order: ${orderId}`);
    const order = await Order.findById(orderId)
      .populate("items.mealId")
      .populate("deliveryAddress")
      .populate("restaurantId");
    if (!order) {
      console.log(`[reorderOrder] Order not found: ${orderId}`);
      return res.redirect("/user/usermain/orders?error=Sipariş bulunamadı");
    }

    console.log(
      `[reorderOrder] Checking authorization for user: ${req.user.uid}`
    );
    if (order.userId.toString() !== req.user.uid.toString()) {
      console.log(`[reorderOrder] Unauthorized access for order: ${orderId}`);
      return res.redirect("/user/usermain/orders?error=Yetkisiz erişim");
    }

    console.log(
      `[reorderOrder] Checking restaurant status: ${order.restaurantId._id}`
    );
    const restaurant = await Restaurant.findById(order.restaurantId);
    if (!restaurant || restaurant.delivery?.case !== "open") {
      console.log(
        `[reorderOrder] Restaurant closed or not found: ${order.restaurantId._id}`
      );
      return res.redirect(
        "/user/usermain/orders?error=Restoran şu anda kapalı"
      );
    }

    console.log(
      `[reorderOrder] Checking meal availability for ${order.items.length} items`
    );
    for (const item of order.items) {
      const meal = await Meal.findById(item.mealId);
      if (!meal || meal.available === false) {
        console.log(`[reorderOrder] Meal unavailable: ${item.name}`);
        return res.redirect(
          `/user/usermain/orders?error=${encodeURIComponent(
            `${item.name} stokta yok`
          )}`
        );
      }
    }

    console.log(`[reorderOrder] Setting user address`);
    const user = await User.findById(req.user.uid);
    if (
      !user.selectedAddressId ||
      user.selectedAddressId.toString() !== order.deliveryAddress._id.toString()
    ) {
      console.log(
        `[reorderOrder] Updating selectedAddressId to: ${order.deliveryAddress._id}`
      );
      user.selectedAddressId = order.deliveryAddress._id;
      await user.save();
    }

    console.log(
      `[reorderOrder] Clearing existing basket for user: ${req.user.uid}`
    );
    await Basket.findOneAndUpdate(
      { uid: req.user.uid },
      {
        items: [],
        totalPrice: 0,
        restaurantId: null,
        restaurantName: null,
        note: "",
      }
    );

    console.log(`[reorderOrder] Creating new basket`);
    const basket = new Basket({
      uid: req.user.uid,
      restaurantId: order.restaurantId._id,
      restaurantName: restaurant.name,
      items: order.items.map((item) => ({
        mealId: item.mealId._id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      totalPrice: order.totalPrice,
      note: order.note || "",
    });
    await basket.save();
    console.log(
      `[reorderOrder] Basket saved: ${basket._id}, Contents: ${JSON.stringify(
        basket
      )}`
    );

    console.log(`[reorderOrder] Calculating cart count`);
    const cartCount = await getCartCount(req.user.uid);
    console.log(`[reorderOrder] Cart count: ${cartCount}`);

    console.log(`[reorderOrder] Fetching address: ${user.selectedAddressId}`);
    const address = await Address.findById(user.selectedAddressId);
    if (!address) {
      console.log(
        `[reorderOrder] Address not found: ${user.selectedAddressId}`
      );
      return res.redirect(
        "/user/usermain/addresses?error=Seçili adres bulunamadı"
      );
    }

    console.log(`[reorderOrder] Calculating order summary`);
    const orderSummary = {
      itemsCount: basket.items.length,
      subtotal: basket.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2),
      shippingFee: "0.00",
      total: basket.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2),
    };
    console.log(
      `[reorderOrder] Order summary: ${JSON.stringify(orderSummary)}`
    );

    console.log(`[reorderOrder] Creating log entry`);
    const userData = await User.findById(req.user.uid).select(
      "firstName lastName email role"
    );
    await Log.create({
      action: "Tekrar Sipariş Başlatıldı",
      actionType: "added",
      description: `${userData.firstName} ${userData.lastName} adlı kullanıcı, "${restaurant.name}" restoranından #${order.orderNumber} numaralı siparişi tekrar başlattı.`,
      user: userData.email,
      role: userData.role,
    });

    console.log(`[reorderOrder] Rendering checkout page`);
    res.render("user/checkout", {
      title: "Ödeme Sayfası",
      user: req.user,
      basket: basket,
      cartCount: cartCount,
      address: address,
      order: orderSummary,
    });
  } catch (error) {
    console.error(`[reorderOrder] Error: ${error.message}`);
    res.redirect(
      "/user/usermain/orders?error=Tekrar sipariş verilirken hata oluştu"
    );
  }
};

module.exports.validateBasket = async (req, res) => {
  try {
    const userId = req.user.uid;
    const basket = await Basket.findOne({ uid: userId }).populate(
      "items.mealId"
    );
    if (!basket || basket.items.length === 0) {
      return res.status(400).json({ success: false, error: "Sepet boş" });
    }

    const restaurant = await Restaurant.findById(basket.restaurantId).select(
      "delivery"
    );
    if (!restaurant) {
      return res
        .status(400)
        .json({ success: false, error: "Restoran bulunamadı" });
    }

    const subtotal = basket.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const minOrderAmount = restaurant.delivery?.minOrderAmount || 0;
    if (subtotal < minOrderAmount) {
      const remainingAmount = (minOrderAmount - subtotal).toFixed(2);
      return res.status(400).json({
        success: false,
        error: `Minimum Sipariş: ${minOrderAmount} TL. Minimum sipariş tutarını geçmek için sepetinize ${remainingAmount} TL değerinde ürün daha eklemeniz gerekmektedir.`,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Sepet doğrulama hatası:", error);
    res
      .status(500)
      .json({ success: false, error: "Sepet doğrulanırken hata oluştu" });
  }
};

// Örnek: Restoran ürün stoğunu güncellerken
module.exports.updateMealStock = async (req, res) => {
  const { mealId, stock } = req.body;
  try {
    const meal = await Meal.findById(mealId);
    if (!meal) {
      return res.status(404).json({ error: "Ürün bulunamadı" });
    }
    meal.stock = stock;
    await meal.save();

    // İlgili sepetleri kontrol et ve kullanıcılara bildir
    const baskets = await Basket.find({ "items.mealId": mealId });
    const io = req.app.get("io");
    baskets.forEach((basket) => {
      if (
        basket.items.some(
          (item) => item.mealId.toString() === mealId && item.quantity > stock
        )
      ) {
        io.to(basket.uid.toString()).emit("stockUpdate", {
          mealId,
          name: meal.name,
          stock,
          message: `${meal.name} ürününün stoğu ${stock} olarak güncellendi. Sepetinizi kontrol edin.`,
        });
      }
    });

    res.json({ success: true, message: "Stok güncellendi" });
  } catch (error) {
    console.error("Stok güncelleme hatası:", error);
    res.status(500).json({ error: "Stok güncellenirken hata oluştu" });
  }
};

// Yeni route: Restoran durumunu güncelleme
module.exports.updateRestaurantStatus = async (req, res) => {
  const { restaurantId, status } = req.body;

  if (!restaurantId || !["open", "closed"].includes(status)) {
    return res
      .status(400)
      .json({ success: false, error: "Geçersiz restoran ID veya durum" });
  }

  try {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res
        .status(404)
        .json({ success: false, error: "Restoran bulunamadı" });
    }

    const previousStatus = restaurant.delivery.case;
    restaurant.delivery.case = status;
    await restaurant.save();

    // Durum değiştiyse ve restoran kapandıysa Socket.IO ile bildir
    if (previousStatus !== status && status === "closed") {
      const io = req.app.get("io");
      io.to(restaurantId.toString()).emit("restaurantStatusUpdate", {
        restaurantId,
        status,
        message: "Restoran şu anda kapalı. Anasayfaya yönlendiriliyorsunuz.",
      });
    }

    res.json({
      success: true,
      message: `Restoran durumu "${status}" olarak güncellendi`,
    });
  } catch (error) {
    console.error("Restoran durumu güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      error: "Restoran durumu güncellenirken hata oluştu",
    });
  }
};