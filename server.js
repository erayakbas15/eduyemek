require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cookieParser = require("cookie-parser");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1); // Hata durumunda uygulamayı durdur
  }
};

// Socket.IO Configuration
io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  // Join restaurant-specific room
  socket.on("joinRestaurant", (restaurantId) => {
    if (!restaurantId) {
      console.error(
        `Socket ${socket.id} tried to join invalid room: ${restaurantId}`
      );
      return;
    }
    socket.join(restaurantId);
    console.log(`Socket ${socket.id} joined room ${restaurantId}`);
  });

  // Log disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Make io available to routes
app.set("io", io);

// View Engine Setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use("/dist", express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// Routes
require("./routers/routeManager")(app);

// Error Handling Middleware (Optional, for unhandled routes)
app.use((req, res, next) => {
  res.status(404).render("error", { message: "Sayfa bulunamadı" });
});

// Start Server
const port = process.env.PORT || 3000;
const startServer = async () => {
  await connectDB(); // MongoDB bağlantısını bekle
  server.listen(port, () => {
    console.log(`Server is running on: http://localhost:${port}`);
  });
};

startServer();