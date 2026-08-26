const express = require("express");

const Task = require("../models/Task");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");

const router = express.Router();

// CREATE TASK
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

    const task = await Task.create({
      customerId: req.userId,
      title,
      category,
      description,
      location,
      budget,
    });

    res.status(201).json({
      message: "Task created successfully.",
      task,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error while creating task.",
    });
  }
});

// GET MY TASKS
router.get("/mine", protect, async (req, res) => {
  try {
    const tasks = await Task.find({
      customerId: req.userId,
    }).sort({
      createdAt: -1,
    });

    res.json(tasks);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error while loading tasks.",
    });
  }
});

// FIND MATCHING PROVIDERS
router.get("/:taskId/providers", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
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

    res.json({
      task,
      providers,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server error while searching providers.",
    });
  }
});

module.exports = router;
