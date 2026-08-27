const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const jwt = require("jsonwebtoken");

const { Server } = require("socket.io");

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");

const taskRoutes = require("./routes/taskRoutes");

const messageRoutes = require("./routes/messageRoutes");

const Task = require("./models/Task");

dotenv.config();

const app = express();

/*
========================================
HTTP SERVER
========================================
*/

const httpServer = http.createServer(app);

/*
========================================
SOCKET.IO
========================================
*/

const io = new Server(httpServer, {
  cors: {
    origin: "*",

    methods: ["GET", "POST", "PATCH"],
  },
});

/*
Make Socket.IO available
inside Express routes.
*/

app.set("io", io);

/*
========================================
EXPRESS MIDDLEWARE
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
API ROUTES
========================================
*/

app.use("/api/auth", authRoutes);

app.use("/api/tasks", taskRoutes);

app.use("/api/messages", messageRoutes);

/*
========================================
SOCKET AUTHENTICATION
========================================
*/

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required."));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.userId = decoded.userId;

    next();
  } catch (error) {
    console.error("Socket authentication error:", error.message);

    next(new Error("Invalid or expired token."));
  }
});

/*
========================================
SOCKET CONNECTION
========================================
*/

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  /*
    ========================================
    JOIN A TASK CHAT ROOM
    ========================================
    */

  socket.on("join_task", async (taskId) => {
    try {
      if (!taskId) {
        return;
      }

      const task = await Task.findById(taskId);

      if (!task) {
        socket.emit("chat_error", {
          message: "Task not found.",
        });

        return;
      }

      const customerId = task.customerId?.toString();

      const providerId = task.assignedProviderId?.toString();

      const currentUserId = socket.userId?.toString();

      const isCustomer = customerId === currentUserId;

      const isProvider = providerId === currentUserId;

      if (!isCustomer && !isProvider) {
        socket.emit("chat_error", {
          message: "You are not authorized to join this conversation.",
        });

        return;
      }

      /*
          Leave previous task rooms
          before joining this one.
          */

      for (const room of socket.rooms) {
        if (room.startsWith("task:")) {
          socket.leave(room);
        }
      }

      const roomName = `task:${taskId}`;

      socket.join(roomName);

      console.log(`User ${socket.userId} joined ${roomName}`);

      socket.emit("joined_task", {
        taskId,
      });
    } catch (error) {
      console.error("Join task socket error:", error.message);

      socket.emit("chat_error", {
        message: "Unable to join conversation.",
      });
    }
  });

  /*
    ========================================
    LEAVE TASK ROOM
    ========================================
    */

  socket.on("leave_task", (taskId) => {
    if (!taskId) {
      return;
    }

    socket.leave(`task:${taskId}`);
  });

  /*
    ========================================
    DISCONNECT
    ========================================
    */

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

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

    httpServer.listen(PORT, () => {
      console.log(`Pata Kazi server running on port ${PORT}`);

      console.log("Socket.IO ready");
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);

    process.exit(1);
  }
};

startServer();
