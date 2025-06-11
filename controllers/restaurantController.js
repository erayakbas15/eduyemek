const mongoose = require("mongoose");
const fs = require("fs").promises; // For file deletion
const User = require("../models/user_db");
const Restaurant = require("../models/restaurant_db");
const Meal = require("../models/meal_db");
const Order = require("../models/order_db");
const bcrypt = require("bcrypt");
const Log = require("../models/log_db");
const Comment = require("../models/comment_db");
const multer = require("multer"); // For file uploads
const path = require("path"); // For path manipulation

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads/"); // Store files in public/uploads/
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // e.g., 1631234567890-123456789.jpg
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Sadece PNG, JPEG ve GIF dosyaları kabul edilir"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Export multer upload middleware for use in routes
exports.upload = upload;



module.exports.getRestaurantDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    const restaurant = await Restaurant.findOne({ ownerId: userId }).lean();
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    const totalMeals = await Meal.countDocuments({
      restaurantId: restaurant._id,
    });
    const activeMeals = await Meal.countDocuments({
      restaurantId: restaurant._id,
      available: true,
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const todayDeliveredOrders = await Order.countDocuments({
      restaurantId: restaurant._id,
      createdAt: { $gte: todayStart, $lte: todayEnd },
      status: "delivered",
    });
    const pendingOrders = await Order.countDocuments({
      restaurantId: restaurant._id,
      status: "pending",
    });
    const preparingOrders = await Order.countDocuments({
      restaurantId: restaurant._id,
      status: "preparing",
    });

    const dailyRevenue = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurant._id,
          status: "delivered",
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalPrice" },
        },
      },
    ]);

    const recentOrders = await Order.find({
      restaurantId: restaurant._id,
      status: { $in: ["pending", "preparing", "on_the_way"] },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({
        path: "userId",
        select: "firstName lastName email selectedAddressId phone",
        populate: {
          path: "selectedAddressId",
          model: "Address",
          select: "formatted_address title address",
          options: { lean: true },
        },
        options: { lean: true },
      })
      .populate({
        path: "items.mealId",
        select: "name",
        options: { lean: true },
      })
      .lean();

    console.log("Recent orders:", JSON.stringify(recentOrders, null, 2));

    const recentMeals = await Meal.find({ restaurantId: restaurant._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const popularMeal = await Order.aggregate([
      { $match: { restaurantId: restaurant._id } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.mealId",
          totalOrdered: { $sum: "$items.quantity" },
          name: { $first: "$items.name" },
        },
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "meals",
          localField: "_id",
          foreignField: "_id",
          as: "meal",
        },
      },
      {
        $unwind: {
          path: "$meal",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          name: { $ifNull: ["$meal.name", "$name", "Bilinmeyen Ürün"] },
          totalOrdered: 1,
        },
      },
    ]);

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurant._id,
          status: "delivered",
          createdAt: {
            $gte: new Date(new Date().setDate(1)).setHours(0, 0, 0, 0),
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalPrice" },
        },
      },
    ]);

    res.render("../views/restaurant/dashboard.ejs", {
      restaurant,
      restaurantId: restaurant._id.toString(),
      stats: {
        totalMeals: totalMeals || 0,
        activeMeals: activeMeals || 0,
        todayDeliveredOrders: todayDeliveredOrders || 0,
        pendingOrders: pendingOrders || 0,
        preparingOrders: preparingOrders || 0,
        dailyRevenue: dailyRevenue[0]?.total || 0,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
      },
      recentOrders: recentOrders || [],
      recentMeals: recentMeals || [],
      popularMeal: popularMeal[0] || { name: "Veri Yok", totalOrdered: 0 },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Restoran siparişlerini görüntüleme sayfası
module.exports.getRestaurantOrdersPage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 20, startDate, endDate } = req.query;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    const filter = { restaurantId: restaurant._id };
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(filter)
      .populate("userId", "firstName lastName email phone")
      .populate("items.mealId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalOrders = await Order.countDocuments(filter);
    const totalPages = Math.ceil(totalOrders / parseInt(limit));

    const statusStats = await Order.aggregate([
      { $match: { restaurantId: restaurant._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    res.render("../views/restaurant/rest_orders.ejs", {
      restaurant,
      restaurantId: restaurant._id.toString(),
      orders,
      statusStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalOrders,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Get orders page error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Restoran menü yönetim sayfası
module.exports.getRestaurantMenuPage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { category, available, page = 1, limit = 20 } = req.query;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    const filter = { restaurantId: restaurant._id };
    if (category) filter.category = category;
    if (available !== undefined) filter.available = available === "true";

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const meals = await Meal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalMeals = await Meal.countDocuments(filter);
    const totalPages = Math.ceil(totalMeals / parseInt(limit));

    const categories = await Meal.distinct("category", {
      restaurantId: restaurant._id,
    });

    res.render("../views/restaurant/rest_menu.ejs", {
      restaurant,
      meals,
      categories,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalMeals,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Get menu page error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Müşteri yorumları sayfası
module.exports.getRestaurantCommentsPage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 6, rating } = req.query;

    // Validate query parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .render("error", { message: "Geçersiz sayfa numarası" });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res
        .status(400)
        .render("error", { message: "Geçersiz limit değeri" });
    }

    const restaurant = await Restaurant.findOne({ ownerId: userId }).lean();
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    const filter = { restaurantId: restaurant._id };
    let ratingNum = null;
    if (rating) {
      ratingNum = parseInt(rating);
      if (ratingNum >= 1 && ratingNum <= 5) {
        filter.rating = ratingNum;
      } else {
        return res
          .status(400)
          .render("error", { message: "Geçersiz puan filtresi" });
      }
    }

    const skip = (pageNum - 1) * limitNum;

    const comments = await Comment.find(filter)
      .populate("userId", "firstName lastName")
      .populate("mealId", "name") // Mevcut mealId için
      .populate({
        path: "orderId", // Sipariş bilgilerini çek
        select: "items", // Sadece items dizisini al
        populate: {
          path: "items.mealId", // Yemek detaylarını çek
          select: "name",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const totalComments = await Comment.countDocuments(filter);
    const totalPages = Math.ceil(totalComments / limitNum);

    const ratingStats = await Comment.aggregate([
      { $match: { restaurantId: restaurant._id } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.render("restaurant/rest_comments", {
      restaurant,
      comments,
      ratingStats,
      rating: ratingNum,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalComments,
        hasNext: pageNum < totalPages && totalComments > limitNum,
        hasPrev: pageNum > 1 && totalComments > limitNum,
      },
      message: req.query.message || "",
    });
  } catch (error) {
    console.error("Get comments page error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

module.exports.getRestaurantReportsPage = async (req, res) => {
  try {
    const userId = req.user._id;

    // Restoran detaylarını al
    const restaurant = await Restaurant.findOne({ ownerId: userId }).lean();
    if (!restaurant) {
      return res.status(404).render("error", { message: "Restoran bulunamadı" });
    }

    const restaurantId = restaurant._id;

    // Query parametrelerinden tarihleri al, yoksa varsayılanları kullan
    const { startDate, endDate } = req.query;
    const today = new Date();
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    defaultEnd.setHours(23, 59, 59, 999); // Ayın son gününün son saati

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : defaultEnd;

    // Tarih doğrulama
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).render("error", { message: "Geçersiz tarih formatı" });
    }
    if (start > end) {
      return res.status(400).render("error", {
        message: "Başlangıç tarihi bitiş tarihinden sonra olamaz",
      });
    }

    const stats = {};

    // Toplam Ciro
    const totalRevenue = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurantId,
          createdAt: { $gte: start, $lte: end },
          status: "delivered",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalPrice" },
        },
      },
    ]);

    stats.totalRevenue = totalRevenue.length > 0 ? totalRevenue[0].total.toFixed(2) : "0.00";
    stats.totalRevenuePeriod = `${start.toLocaleDateString("tr-TR")} - ${end.toLocaleDateString("tr-TR")}`;

    // Toplam Sipariş Sayısı
    const totalOrderCount = await Order.countDocuments({
      restaurantId,
      createdAt: { $gte: start, $lte: end },
      status: "delivered",
    });
    stats.totalOrderCount = totalOrderCount;
    stats.totalOrderPeriod = `${start.toLocaleDateString("tr-TR")} - ${end.toLocaleDateString("tr-TR")}`;

    // En Popüler Ürün
    const popularMeal = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurantId,
          createdAt: { $gte: start, $lte: end },
          status: "delivered",
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.mealId",
          totalOrdered: { $sum: "$items.quantity" },
          name: { $first: "$items.name" },
        },
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "meals",
          localField: "_id",
          foreignField: "_id",
          as: "meal",
        },
      },
      {
        $unwind: {
          path: "$meal",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          name: { $ifNull: ["$meal.name", "$name", "Bilinmeyen Ürün"] },
          totalOrdered: 1,
        },
      },
    ]);

    stats.popularMeal = popularMeal.length > 0
      ? { name: popularMeal[0].name, orderCount: popularMeal[0].totalOrdered }
      : { name: "Veri Yok", orderCount: 0 };

    // Müşteri Memnuniyeti
    const reviews = await Comment.aggregate([
      {
        $match: {
          restaurantId: restaurantId,
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    stats.customerSatisfaction = reviews.length > 0 ? reviews[0].avgRating.toFixed(1) : "0.0";
    stats.reviewCount = reviews.length > 0 ? reviews[0].count : 0;

    // En Popüler Ürünler (Top 6)
    const popularItems = await Order.aggregate([
      {
        $match: {
          restaurantId: restaurantId,
          createdAt: { $gte: start, $lte: end },
          status: "delivered",
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.mealId",
          orderCount: { $sum: "$items.quantity" },
          name: { $first: "$items.name" },
        },
      },
      {
        $lookup: {
          from: "meals",
          localField: "_id",
          foreignField: "_id",
          as: "meal",
        },
      },
      {
        $unwind: {
          path: "$meal",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          name: { $ifNull: ["$meal.name", "$name", "Bilinmeyen Ürün"] },
          orderCount: 1,
        },
      },
      { $sort: { orderCount: -1 } },
      { $limit: 6 },
    ]);

    // Veri kontrolü
    stats.noData = totalOrderCount === 0;

    // Sayfayı render et
    res.render("restaurant/rest_reports", {
      restaurant,
      stats,
      popularItems,
    });
  } catch (error) {
    console.error("Error fetching restaurant reports:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Restoran bilgileri sayfası
module.exports.getRestaurantInfoPage = async (req, res) => {
  try {
    const userId = req.user._id;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    res.render("../views/restaurant/rest_info.ejs", {
      restaurant,
      message: req.query.message || null,
    });
  } catch (error) {
    console.error("Get restaurant info page error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};




module.exports.getRestaurantSettingsPage = async (req, res) => {
  try {
    const userId = req.user._id;
    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      console.log("Restoran bulunamadı, userId:", userId);
      return res.status(404).render("error", { message: "Restoran bulunamadı" });
    }
    const user = await User.findById(userId).select("firstName lastName email phone");
    console.log("Render edilen veriler:", { user, restaurant });
    res.render("../views/restaurant/rest_settings.ejs", {
      restaurant,
      user,
      message: req.query.message || null,
    });
  } catch (error) {
    console.error("Get settings page error:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};






// Ayarları güncelleme işlemi
module.exports.updateRestaurantSettings = async (req, res) => {
  console.log("Gelen form verileri:", req.body);
  try {
    const userId = req.user._id;
    const {
      firstName,
      lastName,
      ownerPhone,
      currentPassword,
      newPassword,
      confirmPassword,
    } = req.body;

    // 1. Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(
        "/restaurant/rest_settings?message=Kullanıcı bulunamadı"
      );
    }

    // 2. Telefon numarası doğrulama
    if (ownerPhone) {
      const phoneRegex = /^(\+90|0)?[0-9]{10}$/;
      const cleanedOwnerPhone = ownerPhone.replace(/\s/g, "");
      if (!phoneRegex.test(cleanedOwnerPhone)) {
        return res.redirect(
          "/restaurant/rest_settings?message=Geçerli bir telefon numarası giriniz"
        );
      }
      user.phone = cleanedOwnerPhone;

      // Update ownerPhone in all restaurants owned by this user
      await Restaurant.updateMany(
        { ownerId: userId },
        { $set: { ownerPhone: cleanedOwnerPhone } }
      );
      console.log(
        `[updateRestaurantSettings] Owner phone updated: ${cleanedOwnerPhone}`
      );
    }

    // 3. Bilgileri güncelle
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;

    // 4. Şifre güncelleme işlemi (isteğe bağlı)
    if (currentPassword && newPassword && confirmPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.redirect(
          "/restaurant/rest_settings?message=Mevcut şifre hatalı"
        );
      }
      if (newPassword !== confirmPassword) {
        return res.redirect(
          "/restaurant/rest_settings?message=Yeni şifreler uyuşmuyor"
        );
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      user.password = hashed;
    }

    await user.save();

    res.redirect("/restaurant/rest_settings?message=Bilgiler güncellendi");
  } catch (error) {
    console.error("Ayarlar güncelleme hatası:", error);
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Restoran bilgilerini güncelleme
module.exports.updateRestaurantInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      description,
      address,
      phone,
      "openingHours.open": open,
      "openingHours.close": close,
      "openingHours.daysOpen.monday": monday,
      "openingHours.daysOpen.tuesday": tuesday,
      "openingHours.daysOpen.wednesday": wednesday,
      "openingHours.daysOpen.thursday": thursday,
      "openingHours.daysOpen.friday": friday,
      "openingHours.daysOpen.saturday": saturday,
      "openingHours.daysOpen.sunday": sunday,
    } = req.body;

    console.log("Received form data:", req.body); // Debugging: Log incoming form data
    console.log("Uploaded file:", req.file); // Debugging: Log uploaded file

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res
        .status(404)
        .render("error", { message: "Restoran bulunamadı" });
    }

    const updateData = {};

    // Basic fields
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;

    // Handle image upload
    if (req.file) {
      // Delete old image if it exists and is a local upload
      if (restaurant.imageUrl && restaurant.imageUrl.startsWith("/uploads/")) {
        try {
          const oldImagePath = path.join(
            __dirname,
            "..",
            "public",
            "uploads",
            path.basename(restaurant.imageUrl)
          );
          await fs.unlink(oldImagePath);
          console.log("Deleted old image:", restaurant.imageUrl);
        } catch (err) {
          console.log("Error deleting old image:", err.message); // Debugging
        }
      }
      updateData.imageUrl = path
        .join("/uploads", req.file.filename)
        .replace(/\\/g, "/"); // Normalize path
    }

    // Handle openingHours
    const hasOpeningHoursData =
      open ||
      close ||
      monday ||
      tuesday ||
      wednesday ||
      thursday ||
      friday ||
      saturday ||
      sunday;
    if (hasOpeningHoursData) {
      updateData.openingHours = {
        open: restaurant.openingHours.open, // Default to existing value
        close: restaurant.openingHours.close, // Default to existing value
        daysOpen: { ...restaurant.openingHours.daysOpen }, // Default to existing values
      };

      // Update open time if provided
      if (open) {
        // Validate HH:mm format
        if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(open)) {
          updateData.openingHours.open = open;
        } else {
          console.log("Invalid open time:", open); // Debugging
          return res.status(400).render("restaurant/rest_info", {
            restaurant,
            message: "Geçersiz açılış saati formatı (HH:mm bekleniyor)",
          });
        }
      }

      // Update close time if provided
      if (close) {
        // Validate HH:mm format
        if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(close)) {
          updateData.openingHours.close = close;
        } else {
          console.log("Invalid close time:", close); // Debugging
          return res.status(400).render("restaurant/rest_info", {
            restaurant,
            message: "Geçersiz kapanış saati formatı (HH:mm bekleniyor)",
          });
        }
      }

      // Update daysOpen if any day is provided
      updateData.openingHours.daysOpen = {
        monday: monday === "on" ? true : false,
        tuesday: tuesday === "on" ? true : false,
        wednesday: wednesday === "on" ? true : false,
        thursday: thursday === "on" ? true : false,
        friday: friday === "on" ? true : false,
        saturday: saturday === "on" ? true : false,
        sunday: sunday === "on" ? true : false,
      };
    }

    // Validation for required fields
    if (!updateData.name) {
      console.log("Missing required name field"); // Debugging
      return res.status(400).render("restaurant/rest_info", {
        restaurant,
        message: "Restoran adı zorunludur",
      });
    }

    // Optional: Validate phone format
    if (updateData.phone && !/^\+?\d{10,12}$/.test(updateData.phone)) {
      console.log("Invalid phone:", updateData.phone); // Debugging
      return res.status(400).render("restaurant/rest_info", {
        restaurant,
        message: "Geçersiz telefon numarası",
      });
    }

    // Optional: Validate imageUrl if required
    if (!restaurant.imageUrl && !updateData.imageUrl) {
      console.log("No image provided"); // Debugging
      // Uncomment if imageUrl is required
      // return res.status(400).render("restaurant/rest_info", {
      //   restaurant,
      //   message: "Restoran görseli zorunludur",
      // });
    }

    console.log("Update data to be applied:", updateData); // Debugging: Log data before update

    // Update the restaurant
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      restaurant._id,
      { $set: updateData },
      { new: true }
    );

    console.log("Updated restaurant:", updatedRestaurant); // Debugging: Log updated document

    res.render("restaurant/rest_info", {
      restaurant: updatedRestaurant,
      message: "Restoran bilgileri güncellendi",
    });
  } catch (error) {
    console.error("Update restaurant error:", error);
    // Handle multer-specific errors
    if (error instanceof multer.MulterError) {
      return res.status(400).render("restaurant/rest_info", {
        restaurant: await Restaurant.findOne({ ownerId: userId }),
        message: error.message || "Dosya yükleme hatası",
      });
    } else if (error.message.includes("Sadece PNG, JPEG ve GIF")) {
      return res.status(400).render("restaurant/rest_info", {
        restaurant: await Restaurant.findOne({ ownerId: userId }),
        message: error.message,
      });
    }
    res.status(500).render("error", { message: "Sunucu hatası", error });
  }
};

// Yeni yemek ekleme
module.exports.addMeal = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, price, category, description } = req.body;

    // Validate required fields
    if (!name || !price || !category) {
      return res.status(400).json({ error: "Tüm alanlar zorunludur" });
    }

    // Find the restaurant
    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    // Prepare meal data
    const mealData = {
      name,
      price: parseFloat(price),
      category,
      description: description || "",
      restaurantId: restaurant._id,
    };

    // Handle image upload
    if (req.file) {
      mealData.imageUrl = `/uploads/${req.file.filename}`;
    }

    // Create and save the new meal
    const newMeal = new Meal(mealData);
    await newMeal.save();

    res.status(200).json({
      message: "Yemek başarıyla eklendi",
      mealId: newMeal._id,
      imageUrl: newMeal.imageUrl,
    });
  } catch (error) {
    console.error("Yemek ekleme hatası:", error);
    res.status(500).json({ error: "Yemek eklenirken bir hata oluştu" });
  }
};



module.exports.deleteMeal = async (req, res) => {
  try {
    const userId = req.user._id;
    const { mealId } = req.params;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    const meal = await Meal.findOne({
      _id: mealId,
      restaurantId: restaurant._id,
    });

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    await Meal.findByIdAndDelete(mealId);

    res.status(200).json({ message: "Yemek başarıyla silindi" });
  } catch (error) {
    console.error("Delete meal error:", error);
    res.status(500).json({ error: "Yemek silinirken bir hata oluştu" });
  }
};




module.exports.updateMeal = async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user._id) {
      return res
        .status(401)
        .json({ error: "Yetkisiz erişim. Lütfen giriş yapın." });
    }

    const userId = req.user._id;
    const { mealId } = req.params;
    const { name, price, description, category } = req.body;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    const meal = await Meal.findOne({
      _id: mealId,
      restaurantId: restaurant._id,
    });

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res
          .status(400)
          .json({ error: "Fiyat geçerli bir sayı olmalı ve negatif olamaz." });
      }
      updateData.price = parsedPrice;
    }
    if (description !== undefined) updateData.description = description;
    if (category) updateData.category = category;

    // Handle image upload
    let imageUrl = meal.imageUrl;
    if (req.file) {
      // Use the filename generated by multer
      imageUrl = `/uploads/${req.file.filename}`;
      updateData.imageUrl = imageUrl;

      // Optionally, delete the old image if it exists and is not the default
      if (meal.imageUrl && meal.imageUrl !== "/uploads/default-meal.jpg") {
        const oldImagePath = path.join(__dirname, "../../public", meal.imageUrl);
        try {
          if (await fs.access(oldImagePath).then(() => true).catch(() => false)) {
            await fs.unlink(oldImagePath);
          }
        } catch (err) {
          console.error("Failed to delete old image:", err);
        }
      }
    }

    const updatedMeal = await Meal.findByIdAndUpdate(mealId, updateData, {
      new: true,
    });

    res.status(200).json({
      message: "Yemek bilgileri güncellendi",
      mealId: updatedMeal._id,
      imageUrl: updatedMeal.imageUrl,
    });
  } catch (error) {
    console.error("Update meal error:", error);
    res.status(500).json({ error: `Sunucu hatası: ${error.message}` });
  }
};

// Restoran menüsünü JSON olarak çekme (API)
module.exports.getRestaurantMenu = async (req, res) => {
  try {
    const userId = req.user._id;
    const { category, available } = req.query;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    const filter = { restaurantId: restaurant._id };
    if (category) filter.category = category;
    if (available !== undefined) filter.available = available === "true";

    const meals = await Meal.find(filter).sort({ createdAt: -1 });

    res.json({
      restaurant: {
        id: restaurant._id,
        name: restaurant.name,
      },
      meals,
    });
  } catch (error) {
    console.error("Get menu API error:", error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
};






module.exports.createOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const { restaurantId, items, deliveryAddressDetails, paymentMethod, note } = req.body;

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    // Validate items and calculate total price
    let totalPrice = 0;
    for (const item of items) {
      const meal = await Meal.findById(item.mealId);
      if (!meal || meal.restaurantId.toString() !== restaurantId) {
        return res.status(400).json({ error: "Geçersiz yemek ID'si" });
      }
      totalPrice += meal.price * (item.quantity || 1);
    }

    // Create new order
    const order = new Order({
      userId,
      restaurantId,
      items,
      totalPrice,
      deliveryAddressDetails,
      paymentMethod,
      note,
      status: "pending", // New orders start with "pending" status
      orderNumber: Math.floor(100000 + Math.random() * 900000), // Generate random order number
    });

    await order.save();

    await order.populate("userId", "firstName lastName email role");

    // Emit newOrder event
    const io = req.app.get("io");
    io.to(restaurantId).emit("newOrder", {
      orderId: order._id,
      status: order.status,
      userId: order.userId,
      items: order.items,
      totalPrice: order.totalPrice,
      createdAt: order.createdAt,
    });

    res.status(201).json({ message: "Sipariş başarıyla created", orderId: order._id });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ error: "Sipariş oluşturulurken hata oluştu" });
  }
};















// Sipariş durumunu güncelleme
module.exports.updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = [
      "pending",
      "preparing",
      "on_the_way",
      "delivered",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).send("Geçersiz sipariş durumu");
    }

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).send("Restoran bulunamadı");
    }

    const order = await Order.findOne({
      _id: orderId,
      restaurantId: restaurant._id,
    });

    if (!order) {
      return res.status(404).send("Sipariş bulunamadı");
    }

    order.status = status;
    await order.save();

    await order.populate("userId", "firstName lastName email role");

    // Emit an event only for status updates, not for new orders
    const io = req.app.get("io");
    io.to(restaurant._id.toString()).emit("orderStatusUpdated", {
      orderId: order._id,
      status: order.status,
      userId: order.userId,
      items: order.items,
      totalPrice: order.totalPrice,
      createdAt: order.createdAt,
    });

    if (status === "delivered") {
      await Log.create({
        action: "Sipariş Teslim Edildi",
        actionType: "updated",
        description: `${order.userId.firstName} ${order.userId.lastName} adlı kullanıcıya ait #${order.orderNumber} numaralı sipariş ${restaurant.name} restoran tarafından teslim edildi.`,
        user: req.user.email,
        role: req.user.role,
      });
    } else if (status === "cancelled") {
      await Log.create({
        action: "Sipariş İptal Edildi",
        actionType: "deleted",
        description: `${order.userId.firstName} ${order.userId.lastName} adlı kullanıcıya ait #${order.orderNumber} numaralı sipariş ${restaurant.name} restoran tarafından iptal edildi.`,
        user: req.user.email,
        role: req.user.role,
      });
    }

    res.redirect("/restaurant/dashboard");
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).send("Sunucu hatası");
  }
};









module.exports.toggleMealAvailability = async (req, res) => {
  try {
    const userId = req.user._id;
    const { mealId } = req.params;
    const { available } = req.body;

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ error: "Restoran bulunamadı" });
    }

    const meal = await Meal.findOne({
      _id: mealId,
      restaurantId: restaurant._id,
    });

    if (!meal) {
      return res.status(404).json({ error: "Yemek bulunamadı" });
    }

    meal.available = available;
    await meal.save();

    res.status(200).json({
      message: `Yemek ${available ? "stoka eklendi" : "stoktan kaldırıldı"}`,
    });
  } catch (error) {
    console.error("Toggle meal availability error:", error);
    res
      .status(500)
      .json({ error: "Stok durumu değiştirilirken bir hata oluştu" });
  }
};


// Restaurant logout
module.exports.restaurantLogout = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      console.error("restaurantLogout: req.user is undefined or missing _id");
      return res.status(401).json({
        success: false,
        message: "Kimlik doğrulama başarısız. Lütfen tekrar giriş yapın.",
      });
    }

    const userId = req.user._id;
    console.log(`restaurantLogout: Processing logout for userId ${userId}`);

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (restaurant) {
      const activeOrders = await Order.countDocuments({
        restaurantId: restaurant._id,
        status: { $in: ["pending", "preparing", "on_the_way"] },
      });

      if (activeOrders > 0) {
        console.log(
          `restaurantLogout: Active orders found for restaurant ${restaurant._id}`
        );
        return res.status(400).json({
          success: false,
          message:
            "Aktif siparişler varken restoran kapatılamaz ve çıkış yapılamaz.",
        });
      }

      restaurant.delivery.case = "closed";
      await restaurant.save();
      console.log(
        `restaurantLogout: Restaurant ${restaurant._id} closed (delivery.case = 'closed')`
      );
    } else {
      console.log(`restaurantLogout: No restaurant found for userId ${userId}`);
    }

    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.json({
      success: true,
      message: "Restoran kapatıldı ve çıkış yapıldı",
    });
  } catch (error) {
    console.error("Restaurant logout error:", error);
    res.status(500).json({
      success: false,
      message: "Çıkış yapılırken hata oluştu",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
};

// Sadece manuel kullanımlı restoran durumu güncelleme
module.exports.toggleRestaurantStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.body; // 'open' veya 'closed'

    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ message: "Restoran bulunamadı" });
    }

    // Aktif sipariş kontrolü YOK, istediği zaman durumu değiştirebilir
    restaurant.manualOverride = true;
    restaurant.delivery.case = status;
    await restaurant.save();

    res.status(200).json({
      message: `Restoran durumu '${status}' olarak güncellendi`,
      status: restaurant.delivery.case,
      manualOverride: restaurant.manualOverride,
    });
  } catch (error) {
    console.error("Toggle restaurant status error:", error);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};


module.exports.replyComment = async (req, res) => {
  try {
    const userId = req.user._id;
    const { commentId, reply } = req.body;

    if (!commentId || !reply) {
      return res
        .status(400)
        .json({ message: "Yorum ID ve yanıt metni gerekli" });
    }

    const restaurant = await Restaurant.findOne({ ownerId: userId }).lean();
    if (!restaurant) {
      return res.status(404).json({ message: "Restoran bulunamadı" });
    }

    const comment = await Comment.findOne({
      _id: commentId,
      restaurantId: restaurant._id,
    });

    if (!comment) {
      return res
        .status(404)
        .json({ message: "Yorum bulunamadı veya bu restorana ait değil" });
    }

    comment.reply = reply;
    comment.repliedAt = new Date();
    await comment.save();

    res.status(200).json({ message: "Yanıt başarıyla gönderildi" });
  } catch (error) {
    console.error("Reply comment error:", error);
    res.status(500).json({ message: "Sunucu hatası" });
  }
};

