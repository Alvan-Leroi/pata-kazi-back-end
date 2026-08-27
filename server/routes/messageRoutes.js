const express = require("express");

const Message = require("../models/Message");

const Task = require("../models/Task");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

/*
========================================
HELPER
CHECK TASK ACCESS
========================================
*/

const getTaskAccess = async (taskId, userId) => {
  const task = await Task.findById(taskId)
    .populate("customerId", "fullName email role")
    .populate("assignedProviderId", "fullName email role");

  if (!task) {
    return {
      error: "Task not found.",

      status: 404,
    };
  }

  const customerId = task.customerId?._id?.toString();

  const providerId = task.assignedProviderId?._id?.toString();

  const currentUserId = userId.toString();

  const isCustomer = customerId === currentUserId;

  const isProvider = providerId === currentUserId;

  if (!isCustomer && !isProvider) {
    return {
      error: "You are not authorized to access this conversation.",

      status: 403,
    };
  }

  if (!providerId) {
    return {
      error: "A provider has not been assigned to this task.",

      status: 400,
    };
  }

  return {
    task,

    customerId,

    providerId,

    isCustomer,

    isProvider,
  };
};

/*
========================================
GET CONVERSATION
GET /api/messages/task/:taskId
========================================
*/

router.get("/task/:taskId", protect, async (req, res) => {
  try {
    const access = await getTaskAccess(req.params.taskId, req.userId);

    if (access.error) {
      return res.status(access.status).json({
        message: access.error,
      });
    }

    const messages = await Message.find({
      taskId: req.params.taskId,
    })
      .populate("senderId", "fullName role")
      .populate("receiverId", "fullName role")
      .sort({
        createdAt: 1,
      });

    /*
      Mark messages sent to
      current user as read.
      */

    await Message.updateMany(
      {
        taskId: req.params.taskId,

        receiverId: req.userId,

        read: false,
      },

      {
        $set: {
          read: true,
        },
      },
    );

    return res.status(200).json({
      task: access.task,

      messages,
    });
  } catch (error) {
    console.error("Load conversation error:", error);

    return res.status(500).json({
      message: "Server error while loading conversation.",
    });
  }
});

/*
========================================
SEND MESSAGE
POST /api/messages/task/:taskId
========================================
*/

router.post("/task/:taskId", protect, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        message: "Message cannot be empty.",
      });
    }

    const access = await getTaskAccess(req.params.taskId, req.userId);

    if (access.error) {
      return res.status(access.status).json({
        message: access.error,
      });
    }

    /*
      Messaging is only available
      while the job is active.
      */

    if (!["assigned", "in-progress"].includes(access.task.status)) {
      return res.status(400).json({
        message: "Messages can only be sent for an active job.",
      });
    }

    const receiverId = access.isCustomer
      ? access.providerId
      : access.customerId;

    /*
      Save message
      */

    const newMessage = await Message.create({
      taskId: access.task._id,

      senderId: req.userId,

      receiverId,

      text: text.trim(),
    });

    /*
      Populate sender and receiver
      before sending to clients.
      */

    await newMessage.populate("senderId", "fullName role");

    await newMessage.populate("receiverId", "fullName role");

    /*
      ========================================
      REAL-TIME SOCKET EVENT
      ========================================
      */

    const io = req.app.get("io");

    if (io) {
      io.to(`task:${req.params.taskId}`).emit("new_message", newMessage);
    }

    return res.status(201).json({
      success: true,

      message: "Message sent.",

      data: newMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);

    return res.status(500).json({
      message: "Server error while sending message.",
    });
  }
});

module.exports = router;
