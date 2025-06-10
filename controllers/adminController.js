const mongoose = require("mongoose");
const User = require("../models/user_db");
const Restaurant = require("../models/restaurant_db");
const Meal = require("../models/meal_db");
const Comment = require("../models/comment_db");
const Order = require("../models/order_db");
const bcrypt = require("bcryptjs");
const Log = require("../models/log_db");
const axios = require("axios"); // Ensure this is added at the top

const geocodeAddress = async (address) => {
  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address,
          key: process.env.GOOGLE_API_KEY,
          language: "tr",
          region: "tr",
        },
        timeout: 5000,
      }
    );

    const data = response.data;

    if (data.status !== "OK" || data.results.length === 0) {
      throw new Error(`Geocoding failed: ${data.status}`);
    }

    return data.results[0].geometry.location;
  } catch (error) {
    console.error("Geocoding error:", error);
    throw new Error("Adres koordinatlara çevrilemedi");
  }
};
module.exports.adminDashboard = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: "student" });
    const totalRestaurants = await Restaurant.countDocuments();
    const totalMeals = await Meal.countDocuments();
    const totalOrders = await Order.countDocuments();

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weeklyOrders = await Order.countDocuments({
      createdAt: { $gte: weekAgo },
    });

    const orderStatuses = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // 🔴 Son aktiviteleri çek
    const logs = await Log.find().sort({ createdAt: -1 }).limit(10);

    // 🔄 Frontend için uygun formata dönüştür
    const recentActivities = logs.map((log) => {
      let actionType = "info";
      if (log.action.toLowerCase().includes("kayıt")) actionType = "added";
      else if (log.action.toLowerCase().includes("güncelle"))
        actionType = "updated";
      else if (log.action.toLowerCase().includes("sil")) actionType = "deleted";

      return {
        date: new Date(log.createdAt).toLocaleString("tr-TR"),
        user: log.userEmail || log.user || "Sistem", // 🟢 Kullanıcı kolonu artık E-MAIL
        action: log.action,
        actionType: log.actionType || "info", // 🔥 Direkt log'dan al
        details: log.description, // 🟢 description'da isim olacak
        role: log.role || "-",
      };
    });

    // JSON istek ise
    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({
        stats: {
          totalUsers,
          totalRestaurants,
          totalMeals,
          totalOrders,
          weeklyOrders,
        },
        orderStatuses,
        recentActivities, // 🆕 burası eklendi
      });
    }

    // Sayfa render edilecekse
    res.render("../views/admin/dashboard.ejs", {
      stats: {
        totalUsers,
        totalRestaurants,
        totalMeals,
        totalOrders,
        weeklyOrders,
      },
      orderStatuses,
      recentActivities, // 🆕 burası eklendi
    });
  } catch (err) {
    console.error("Dashboard istatistik hatası:", err);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(500).json({
        error: "İstatistikler alınırken hata oluştu",
        stats: null,
        orderStatuses: null,
        recentActivities: [],
      });
    }

    res.status(500).render("../views/admin/dashboard.ejs", {
      stats: null,
      orderStatuses: null,
      recentActivities: [],
      error: "İstatistikler alınırken hata oluştu",
    });
  }
};

module.exports.adminUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      role = "",
      status = "all",
    } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    if (role && role !== "all") {
      query.role = role;
    }
    if (status && status !== "all") {
      query.status = status;
    }
    if (search) {
      query = {
        ...query,
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }

    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({
        users,
        search,
        role,
        status,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      });
    }

    res.render("../views/admin/users.ejs", {
      users,
      search,
      role,
      status,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Kullanıcı listesi hatası:", err);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(500).json({
        error: "Kullanıcılar alınırken hata oluştu",
        users: [],
        search: "",
        role: "",
        status: "all",
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          pages: 0,
        },
      });
    }

    res.status(500).render("../views/admin/users.ejs", {
      users: [],
      search: "",
      role: "",
      status: "all",
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        pages: 0,
      },
      error: "Kullanıcılar alınırken hata oluştu",
    });
  }
};

module.exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    res.json({ user });
  } catch (err) {
    console.error("Kullanıcı getirme hatası:", err);
    res
      .status(500)
      .json({ error: "Kullanıcı bilgileri alınırken hata oluştu" });
  }
};

module.exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, role, status } = req.body;

    const existingUser = await User.findOne({ email, _id: { $ne: id } });
    if (existingUser) {
      return res.status(400).json({
        error: "Bu email adresi başka bir kullanıcı tarafından kullanılıyor",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { firstName, lastName, email, role, status },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    res.json({
      message: "Kullanıcı başarıyla güncellendi",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Kullanıcı güncelleme hatası:", err);
    res.status(500).json({ error: "Kullanıcı güncellenirken hata oluştu" });
  }
};

module.exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user && req.user._id.toString() === id) {
      return res.status(400).json({ error: "Kendi hesabınızı silemezsiniz" });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    res.json({ message: "Kullanıcı başarıyla silindi" });
  } catch (err) {
    console.error("Kullanıcı silme hatası:", err);
    res.status(500).json({ error: "Kullanıcı silinirken hata oluştu" });
  }
};

module.exports.getRestaurantById = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }
    res.json({ restaurant });
  } catch (err) {
    console.error("Restoran getirme hatası:", err);
    res.status(500).json({ error: "Restoran alınırken bir hata oluştu" });
  }
};

module.exports.createRestaurant = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      phone,
      email,
      password,
      ownerPhone, // New field
      openingHours,
      delivery,
      status,
    } = req.body;

    // Basic validation
    if (!name || !address || !phone || !email || !password || !ownerPhone) {
      return res.status(400).json({
        error: "Name, address, phone, email, ownerPhone ve password zorunludur",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Geçerli bir email adresi giriniz",
      });
    }

    // Phone format validation (Turkish format)
    const phoneRegex = /^(\+90|0)?[0-9]{10}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
      return res.status(400).json({
        error: "Geçerli bir telefon numarası giriniz",
      });
    }

    // Owner phone format validation (Turkish format)
    if (!phoneRegex.test(ownerPhone.replace(/\s/g, ""))) {
      return res.status(400).json({
        error: "Geçerli bir sahip telefon numarası giriniz",
      });
    }

    if (delivery && !["open", "closed"].includes(delivery.case)) {
      return res.status(400).json({
        error: 'Delivery case must be "open" or "closed"',
      });
    }

    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        error: 'Status must be "active" or "inactive"',
      });
    }

    // Check for existing user with the same email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        error: "Bu email ile zaten bir kullanıcı var",
      });
    }

    // Geocode the address
    console.log(`[createRestaurant] Geocoding address: ${address}`);

    let location;
    try {
      location = await geocodeAddress(address);
      console.log(`[createRestaurant] Geocoded location:`, location);
    } catch (error) {
      return res.status(400).json({
        error: "Adres bulunamadı veya geçersiz: " + error.message,
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create rest_owner user
    const newUser = new User({
      email,
      password: hashedPassword,
      role: "rest_owner",
      phone: ownerPhone, // Use ownerPhone for the User model
      firstName: null,
      lastName: null,
      isVerified: true,
    });

    await newUser.save();
    console.log(`[createRestaurant] User created with ID: ${newUser._id}`);

    // Create restaurant with geocoded location and ownerPhone
    const newRestaurant = new Restaurant({
      name,
      description: description || "",
      address,
      phone,
      email,
      ownerPhone, // Save ownerPhone to restaurant
      openingHours: {
        open: openingHours?.open || "09:00",
        close: openingHours?.close || "21:00",
        daysOpen: {
          monday: openingHours?.daysOpen?.monday ?? true,
          tuesday: openingHours?.daysOpen?.tuesday ?? true,
          wednesday: openingHours?.daysOpen?.wednesday ?? true,
          thursday: openingHours?.daysOpen?.thursday ?? true,
          friday: openingHours?.daysOpen?.friday ?? true,
          saturday: openingHours?.daysOpen?.saturday ?? true,
          sunday: openingHours?.daysOpen?.sunday ?? false,
        },
      },
      delivery: {
        case: delivery?.case || "open",
        estimatedTime: delivery?.estimatedTime || "30-45 dk",
        minOrderAmount: delivery?.minOrderAmount || 0,
      },
      rating: { average: 0, count: 0 },
      status: status || "active",
      ownerId: newUser._id,
      location: {
        lat: location.lat,
        lng: location.lng,
      },
    });

    await newRestaurant.save();

    console.log(`[createRestaurant] Restaurant created: ${name}`);
    console.log(
      `[createRestaurant] Location saved: lat=${location.lat}, lng=${location.lng}`
    );

    res.status(201).json({
      message: "Restoran ve kullanıcı başarıyla oluşturuldu",
      restaurant: newRestaurant,
      location: {
        lat: location.lat,
        lng: location.lng,
        address: address,
      },
    });
  } catch (err) {
    console.error("Restoran oluşturma hatası:", err);
    res.status(500).json({
      error: "Sunucu hatası: " + err.message,
    });
  }
};

module.exports.deleteRestaurant = async (req, res) => {
  try {
    const { id } = req.params;

    await Meal.deleteMany({ restaurant: id });

    const deletedRestaurant = await Restaurant.findByIdAndDelete(id);

    if (!deletedRestaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    res.json({ message: "Restoran ve ilişkili yemekler başarıyla silindi" });
  } catch (err) {
    console.error("Restoran silme hatası:", err);
    res.status(500).json({ error: "Restoran silinirken bir hata oluştu" });
  }
};

module.exports.updateRestaurant = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      phone,
      ownerPhone,
      email,
      openingHours,
      delivery,
      status,
    } = req.body;
    const { id } = req.params;

    // Validate required fields
    if (!name || !address || !phone) {
      return res.status(400).json({
        error: "Name, address, and phone are required",
      });
    }

    // Email format validation
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: "Geçerli bir email adresi giriniz",
        });
      }
    }

    // Phone format validation
    const phoneRegex = /^(\+90|0)?[0-9]{10}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
      return res.status(400).json({
        error: "Geçerli bir telefon numarası giriniz",
      });
    }

    // Validate delivery case
    if (delivery && !["open", "closed"].includes(delivery.case)) {
      return res.status(400).json({
        error: 'Delivery case must be "open" or "closed"',
      });
    }

    // Validate status
    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        error: 'Status must be "active" or "inactive"',
      });
    }

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        error: "Restoran bulunamadı",
      });
    }

    // Geocode the address if it has changed
    let location = restaurant.location;
    if (address !== restaurant.address) {
      console.log(
        `[updateRestaurant] Address changed, geocoding new address: ${address}`
      );

      try {
        const newLocation = await geocodeAddress(address);
        console.log(`[updateRestaurant] New geocoded location:`, newLocation);

        location = newLocation;
      } catch (error) {
        return res.status(400).json({
          error: "Adres bulunamadı veya geçersiz: " + error.message,
        });
      }
    }

    // Update fields
    restaurant.name = name;
    restaurant.description = description || "";
    restaurant.address = address;
    restaurant.phone = phone;
    restaurant.ownerPhone = ownerPhone || restaurant.ownerPhone;
    restaurant.email = email || "";
    restaurant.openingHours = {
      open: openingHours?.open || restaurant.openingHours.open,
      close: openingHours?.close || restaurant.openingHours.close,
      daysOpen: {
        monday:
          openingHours?.daysOpen?.monday ??
          restaurant.openingHours.daysOpen.monday,
        tuesday:
          openingHours?.daysOpen?.tuesday ??
          restaurant.openingHours.daysOpen.tuesday,
        wednesday:
          openingHours?.daysOpen?.wednesday ??
          restaurant.openingHours.daysOpen.wednesday,
        thursday:
          openingHours?.daysOpen?.thursday ??
          restaurant.openingHours.daysOpen.thursday,
        friday:
          openingHours?.daysOpen?.friday ??
          restaurant.openingHours.daysOpen.friday,
        saturday:
          openingHours?.daysOpen?.saturday ??
          restaurant.openingHours.daysOpen.saturday,
        sunday:
          openingHours?.daysOpen?.sunday ??
          restaurant.openingHours.daysOpen.sunday,
      },
    };
    restaurant.delivery = {
      case: delivery?.case || restaurant.delivery.case,
      estimatedTime:
        delivery?.estimatedTime || restaurant.delivery.estimatedTime,
      minOrderAmount:
        delivery?.minOrderAmount ?? restaurant.delivery.minOrderAmount,
    };
    restaurant.status = status || restaurant.status;

    // Update location coordinates
    restaurant.location = {
      lat: location.lat,
      lng: location.lng,
    };

    // Update owner's phone in User model if ownerPhone is provided
    if (ownerPhone) {
      const owner = await User.findById(restaurant.ownerId);
      if (!owner) {
        return res.status(404).json({
          error: "Restoran sahibi bulunamadı",
        });
      }
      const cleanedOwnerPhone = ownerPhone.replace(/\s/g, "");
      if (!phoneRegex.test(cleanedOwnerPhone)) {
        return res.status(400).json({
          error: "Geçerli bir sahip telefon numarası giriniz",
        });
      }
      owner.phone = cleanedOwnerPhone;
      await owner.save();
      console.log(`[updateRestaurant] Owner phone updated: ${cleanedOwnerPhone}`);
    }

    await restaurant.save();

    console.log(`[updateRestaurant] Restaurant updated: ${name}`);
    console.log(
      `[updateRestaurant] Location updated: lat=${location.lat}, lng=${location.lng}`
    );

    res.status(200).json({
      message: "Restoran başarıyla güncellonumber: Bu güncelleme şunları içeriyor: - Restoran bilgileri - Sahibin telefon numarası (User modelinde güncellendi)",
      restaurant,
      location: {
        lat: location.lat,
        lng: location.lng,
        address: address,
      },
    });
  } catch (err) {
    console.error("Restoran güncelleme hatası:", err);
    res.status(500).json({
      error: "Restoran güncellenirken hata oluştu: " + err.message,
    });
  }
};

module.exports.createMeal = async (req, res) => {
  try {
    const { name, description, price, restaurantId } = req.body;

    const newMeal = new Meal({
      name,
      description,
      price,
      restaurantId,
    });

    await newMeal.save();

    res.status(201).json({ message: "Yemek başarıyla eklendi", meal: newMeal });
  } catch (err) {
    console.error("Yemek ekleme hatası:", err);
    res.status(500).json({ error: "Yemek eklenirken hata oluştu" });
  }
};

module.exports.adminRestaurants = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const query = {};

    if (status === "active") query.isActive = true;
    else if (status === "inactive") query.isActive = false;

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const total = await Restaurant.countDocuments(query);
    const restaurants = await Restaurant.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const restaurantsWithMenuCount = await Promise.all(
      restaurants.map(async (restaurant) => {
        const menuCount = await Meal.countDocuments({
          restaurantId: restaurant._id,
        });
        return { ...restaurant._doc, menuCount };
      })
    );

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({
        restaurants: restaurantsWithMenuCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    }

    res.render("admin/restaurants", {
      user: req.user,
      restaurants: restaurantsWithMenuCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("adminRestaurants hatası:", err);
    res.status(500).send("Sunucu hatası");
  }
};

module.exports.getRestaurantsForFilter = async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "all", search = "" } = req.query;

    const filter = {};

    if (status === "active") {
      filter.isActive = true;
    } else if (status === "inactive") {
      filter.isActive = false;
    }

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { address: regex },
        { phone: regex },
        { email: regex },
      ];
    }

    const total = await Restaurant.countDocuments(filter);
    const restaurants = await Restaurant.find(filter)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    return res.json({
      restaurants,
      pagination: {
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Restoran listesi hatası:", err);
    res.status(500).json({
      error: "Restoranlar alınırken hata oluştu",
      restaurants: [],
      pagination: null,
    });
  }
};

module.exports.adminMeals = async (req, res) => {
  try {
    const { page = 1, limit = 20, restaurantId = "", search = "" } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    if (restaurantId) {
      query.restaurantId = restaurantId;
    }
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const meals = await Meal.find(query)
      .populate("restaurantId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Meal.countDocuments(query);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({
        meals,
        search,
        restaurantId,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      });
    }

    res.render("../views/admin/meals.ejs", {
      meals,
      search,
      restaurantId,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Yemek listesi hatası:", err);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(500).json({
        error: "Yemekler alınırken hata oluştu",
        meals: [],
        search: "",
        restaurantId: "",
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          pages: 0,
        },
      });
    }

    res.status(500).render("../views/admin/meals.ejs", {
      meals: [],
      search: "",
      restaurantId: "",
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        pages: 0,
      },
      error: "Yemekler alınırken hata oluştu",
    });
  }
};

module.exports.adminOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "", search = "" } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let matchQuery = {};
    if (status) {
      matchQuery.status = status;
    }

    // Aggregation pipeline
    let pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userData",
        },
      },
      {
        $lookup: {
          from: "restaurants",
          localField: "restaurantId",
          foreignField: "_id",
          as: "restaurantData",
        },
      },
      { $unwind: { path: "$userData", preserveNullAndEmptyArrays: true } },
      {
        $unwind: { path: "$restaurantData", preserveNullAndEmptyArrays: true },
      },
    ];

    // Add search conditions
    if (search) {
      const regex = new RegExp(search, "i");
      const searchConditions = [
        { orderNumber: !isNaN(search) ? Number(search) : -1 },
        { "userData.firstName": regex },
        { "userData.lastName": regex },
        { "userData.email": regex },
        { "restaurantData.name": regex },
      ];
      pipeline.push({ $match: { $or: searchConditions } });
    }

    // Add sorting and pagination
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    );

    const orders = await Order.aggregate(pipeline);

    // Format orders for response
    const formattedOrders = orders.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      items: order.items,
      totalPrice: order.totalPrice,
      deliveryAddress: order.deliveryAddress,
      status: order.status,
      createdAt: order.createdAt,
      user: order.userData
        ? {
            name: `${order.userData.firstName || ""} ${
              order.userData.lastName || ""
            }`.trim(),
            email: order.userData.email || "",
          }
        : null,
      restaurant: order.restaurantData
        ? {
            name: order.restaurantData.name || "",
          }
        : null,
    }));

    // Calculate total for pagination
    const countPipeline = pipeline.slice(0, -2); // Remove skip and limit for count
    const countResult = await Order.aggregate([
      ...countPipeline,
      { $count: "total" },
    ]);
    const total = countResult[0]?.total || 0;

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({
        orders: formattedOrders,
        search,
        status,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      });
    }

    res.render("../views/admin/orders.ejs", {
      orders: formattedOrders,
      search,
      status,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Sipariş listesi hatası:", err);

    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(500).json({
        error: "Siparişler alınırken hata oluştu",
        orders: [],
        search: "",
        status: "",
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          pages: 0,
        },
      });
    }

    res.status(500).render("../views/admin/orders.ejs", {
      orders: [],
      search: "",
      status: "",
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        pages: 0,
      },
      error: "Siparişler alınırken hata oluştu",
    });
  }
};

module.exports.updateMeal = async (req, res) => {
  try {
    console.log("✅ updateMeal fonksiyonu çalıştı");
    console.log("ID:", req.params.id);
    console.log("Body:", req.body);
    console.log("User:", req.user);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("❌ Geçersiz ID formatı:", req.params.id);
      return res.status(400).json({ error: "Geçersiz ID formatı" });
    }

    const existingMeal = await Meal.findById(req.params.id);
    if (!existingMeal) {
      console.log("❌ Yemek bulunamadı:", req.params.id);
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    console.log("✅ Mevcut yemek bulundu:", existingMeal.name);

    if (req.body.restaurantId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.restaurantId)) {
        console.log("❌ Geçersiz restoran ID formatı:", req.body.restaurantId);
        return res.status(400).json({ error: "Geçersiz restoran ID formatı" });
      }
      const restaurant = await Restaurant.findById(req.body.restaurantId);
      if (!restaurant) {
        console.log("❌ Restoran bulunamadı:", req.body.restaurantId);
        return res.status(400).json({ error: "Restoran bulunamadı" });
      }
      console.log("✅ Restoran bulundu:", restaurant.name);
    }

    if (req.body.price !== undefined && !isNaN(req.body.price)) {
      req.body.price = parseFloat(req.body.price);
      console.log("✅ Fiyat dönüştürüldü:", req.body.price);
    } else if (req.body.price !== undefined) {
      console.log("❌ Geçersiz fiyat:", req.body.price);
      return res.status(400).json({ error: "Geçersiz fiyat formatı" });
    }

    const updateData = {
      ...(req.body.name && { name: req.body.name }),
      ...(req.body.category && { category: req.body.category }),
      ...(req.body.price !== undefined && { price: req.body.price }),
      ...(req.body.description !== undefined && {
        description: req.body.description,
      }),
      restaurantId: req.body.restaurantId || existingMeal.restaurantId,
    };

    console.log("✅ Güncelleme verisi:", updateData);

    const updatedMeal = await Meal.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).populate("restaurantId", "name");

    if (!updatedMeal) {
      console.log("❌ Yemek güncellenemedi");
      return res.status(404).json({ error: "Yemek güncellenemedi" });
    }

    console.log("✅ Yemek başarıyla güncellendi:", updatedMeal.name);

    res.json({
      success: true,
      meal: updatedMeal,
      message: "Yemek başarıyla güncellendi",
    });
  } catch (error) {
    console.error("❌ Meal update error:", error);
    console.error("❌ Error name:", error.name);
    console.error("❌ Error message:", error.message);
    console.error("❌ Error stack:", error.stack);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      console.log("❌ Validation errors:", errors);
      return res.status(400).json({
        error: "Validation hatası",
        details: errors,
      });
    }

    if (error.name === "CastError") {
      console.log("❌ Cast error:", error.message);
      return res.status(400).json({
        error: "Geçersiz ID formatı",
        details: error.message,
      });
    }

    res.status(500).json({
      error: "Yemek güncellenirken hata oluştu",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

module.exports.deleteMeal = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedMeal = await Meal.findByIdAndDelete(id);
    if (!deletedMeal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }
    res.json({ message: "Yemek başarıyla silindi" });
  } catch (err) {
    console.error("Yemek silme hatası:", err);
    res.status(500).json({ error: "Yemek silinirken hata oluştu" });
  }
};

module.exports.getMealById = async (req, res) => {
  try {
    const { id } = req.params;
    const meal = await Meal.findById(id).populate("restaurantId", "name");
    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }
    res.json({ meal });
  } catch (err) {
    console.error("Yemek getirme hatası:", err);
    res.status(500).json({ error: "Yemek bilgileri alınırken hata oluştu" });
  }
};
