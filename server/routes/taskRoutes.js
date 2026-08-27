const express = require("express");

const Task = require("../models/Task");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

/*
========================================
CREATE A TASK
POST /api/tasks
========================================
*/

router.post("/", protect, async (req, res) => {
  try {
    const { title, category, description, location, budget } = req.body;

    if (
      !title ||
      !category ||
      !description ||
      !location ||
      budget === undefined
    ) {
      return res.status(400).json({
        message: "Please complete all task fields.",
      });
    }

    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can post tasks.",
      });
    }

    const task = await Task.create({
      customerId: req.userId,
      title: title.trim(),
      category: category.trim(),
      description: description.trim(),
      location: location.trim(),
      budget: Number(budget),
    });

    return res.status(201).json({
      success: true,
      message: "Task created successfully.",
      task,
    });
  } catch (error) {
    console.error("Create task error:", error);

    return res.status(500).json({
      message: "Server error while creating task.",
    });
  }
});

/*
========================================
GET MY TASKS
GET /api/tasks/mine
========================================
*/

router.get("/mine", protect, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (user.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can view posted tasks.",
      });
    }

    const tasks = await Task.find({
      customerId: req.userId,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json(tasks);
  } catch (error) {
    console.error("Load customer tasks error:", error);

    return res.status(500).json({
      message: "Server error while loading tasks.",
    });
  }
});

/*
========================================
GET OPEN JOBS FOR PROVIDERS
GET /api/tasks/open
========================================
*/

router.get("/open", protect, async (req, res) => {
  try {
    const provider = await User.findById(req.userId);

    if (!provider) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can view open jobs.",
      });
    }

    const tasks = await Task.find({
      status: "open",
    })
      .populate("customerId", "fullName location")
      .sort({
        createdAt: -1,
      });

    return res.status(200).json(tasks);
  } catch (error) {
    console.error("Load open jobs error:", error);

    return res.status(500).json({
      message: "Server error while loading open jobs.",
    });
  }
});

/*
========================================
GET MATCHING PROVIDERS FOR A TASK
GET /api/tasks/:taskId/providers
========================================
*/

router.get("/:taskId/providers", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    if (task.customerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        message: "You are not authorized to view providers for this task.",
      });
    }

    const providers = await User.find({
      role: "provider",

      services: {
        $in: [task.category],
      },

      location: {
        $regex: task.location,
        $options: "i",
      },
    }).select("fullName email phone location services rating");

    return res.status(200).json({
      task,
      providers,
    });
  } catch (error) {
    console.error("Provider search error:", error);

    return res.status(500).json({
      message: "Server error while searching providers.",
    });
  }
});

module.exports = router;
