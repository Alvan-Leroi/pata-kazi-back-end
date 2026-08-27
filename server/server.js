const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");

const taskRoutes = require("./routes/taskRoutes");

const messageRoutes = require("./routes/messageRoutes");

dotenv.config();

const app = express();

/*
========================================
MIDDLEWARE
========================================
*/

app.use(cors());

app.use(express.json());

/*
========================================
HEALTH CHECK
========================================
*/

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Pata Kazi API is running",
  });
});

/*
========================================
ROUTES
========================================
*/

app.use("/api/auth", authRoutes);

app.use("/api/tasks", taskRoutes);

app.use("/api/messages", messageRoutes);

/*
========================================
PORT
========================================
*/

const PORT = process.env.PORT || 5000;

/*
========================================
START SERVER
========================================
*/

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Pata Kazi server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);

    process.exit(1);
  }
};

startServer();
