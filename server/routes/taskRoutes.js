const express = require("express");

const Task = require("../models/Task");
const User = require("../models/User");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

/*
========================================
CREATE A TASK
POST /api/tasks
CUSTOMER ONLY
========================================
*/

router.post("/", protect, async (req, res) => {
  try {
    const { title, category, description, location, budget } = req.body;

    /*
      ------------------------------------
      VALIDATE FIELDS
      ------------------------------------
      */

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

    /*
      ------------------------------------
      GET LOGGED-IN USER
      ------------------------------------
      */

    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    /*
      ------------------------------------
      CUSTOMER ONLY
      ------------------------------------
      */

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can post tasks.",
      });
    }

    /*
      ------------------------------------
      VALIDATE BUDGET
      ------------------------------------
      */

    const numericBudget = Number(budget);

    if (Number.isNaN(numericBudget) || numericBudget < 0) {
      return res.status(400).json({
        message: "Please enter a valid budget.",
      });
    }

    /*
      ------------------------------------
      CREATE TASK
      ------------------------------------
      */

    const task = await Task.create({
      customerId: req.userId,

      title: title.trim(),

      category: category.trim(),

      description: description.trim(),

      location: location.trim(),

      budget: numericBudget,
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
GET CUSTOMER'S OWN TASKS
GET /api/tasks/mine
CUSTOMER ONLY
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
GET OPEN JOBS
GET /api/tasks/open
PROVIDER ONLY
========================================
*/

router.get("/open", protect, async (req, res) => {
  try {
    /*
      ------------------------------------
      GET PROVIDER
      ------------------------------------
      */

    const provider = await User.findById(req.userId);

    if (!provider) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    /*
      ------------------------------------
      PROVIDER ONLY
      ------------------------------------
      */

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can view open jobs.",
      });
    }

    /*
      ------------------------------------
      FIND OPEN TASKS
      ------------------------------------
      */

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
GET ONE JOB / TASK
GET /api/tasks/:taskId
CUSTOMER OWNER OR PROVIDER
========================================
*/

router.get("/:taskId", protect, async (req, res) => {
  try {
    /*
      ------------------------------------
      GET LOGGED-IN USER
      ------------------------------------
      */

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    /*
      ------------------------------------
      FIND TASK
      ------------------------------------
      */

    const task = await Task.findById(req.params.taskId).populate(
      "customerId",
      "fullName location",
    );

    if (!task) {
      return res.status(404).json({
        message: "Job not found.",
      });
    }

    /*
      ------------------------------------
      PROVIDER ACCESS
      ------------------------------------

      Providers can view jobs only
      while they are available.
      */

    if (user.role === "provider") {
      if (task.status !== "open") {
        return res.status(403).json({
          message: "This job is no longer available.",
        });
      }

      return res.status(200).json(task);
    }

    /*
      ------------------------------------
      CUSTOMER ACCESS
      ------------------------------------

      Customers can only view their
      own task.
      */

    if (user.role === "customer") {
      const taskCustomerId = task.customerId?._id
        ? task.customerId._id.toString()
        : task.customerId.toString();

      if (taskCustomerId !== req.userId.toString()) {
        return res.status(403).json({
          message: "You are not authorized to view this task.",
        });
      }

      return res.status(200).json(task);
    }

    /*
      ------------------------------------
      UNKNOWN ROLE
      ------------------------------------
      */

    return res.status(403).json({
      message: "You are not authorized to view this task.",
    });
  } catch (error) {
    console.error("Load task error:", error);

    /*
      ------------------------------------
      INVALID MONGODB ID
      ------------------------------------
      */

    if (error.name === "CastError") {
      return res.status(404).json({
        message: "Job not found.",
      });
    }

    return res.status(500).json({
      message: "Server error while loading job.",
    });
  }
});

/*
========================================
GET MATCHING PROVIDERS
GET /api/tasks/:taskId/providers
CUSTOMER OWNER ONLY
========================================
*/

router.get("/:taskId/providers", protect, async (req, res) => {
  try {
    /*
      ------------------------------------
      GET USER
      ------------------------------------
      */

    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    /*
      ------------------------------------
      CUSTOMER ONLY
      ------------------------------------
      */

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can view matching providers.",
      });
    }

    /*
      ------------------------------------
      FIND TASK
      ------------------------------------
      */

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    /*
      ------------------------------------
      VERIFY OWNERSHIP
      ------------------------------------
      */

    if (task.customerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        message: "You are not authorized to view providers for this task.",
      });
    }

    /*
      ------------------------------------
      FIND MATCHING PROVIDERS
      ------------------------------------
      */

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

    /*
      ------------------------------------
      RETURN MATCHES
      ------------------------------------
      */

    return res.status(200).json({
      task,
      providers,
    });
  } catch (error) {
    console.error("Provider search error:", error);

    if (error.name === "CastError") {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    return res.status(500).json({
      message: "Server error while searching providers.",
    });
  }
});

module.exports = router;
