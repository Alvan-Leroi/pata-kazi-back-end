const express = require("express");

const Task = require("../models/Task");
const User = require("../models/User");
const Offer = require("../models/Offer");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

/*
========================================
CREATE TASK
POST /api/tasks
CUSTOMER ONLY
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

    const numericBudget = Number(budget);

    if (Number.isNaN(numericBudget) || numericBudget < 0) {
      return res.status(400).json({
        message: "Please enter a valid budget.",
      });
    }

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
GET MY CUSTOMER TASKS
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
GET OPEN JOBS
GET /api/tasks/open
PROVIDER ONLY
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
SEND AN OFFER
POST /api/tasks/:taskId/offers
PROVIDER ONLY
========================================
*/

router.post("/:taskId/offers", protect, async (req, res) => {
  try {
    const { amount, message } = req.body;

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

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can send offers.",
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
        message: "Job not found.",
      });
    }

    /*
      ------------------------------------
      CHECK JOB STATUS
      ------------------------------------
      */

    if (task.status !== "open") {
      return res.status(400).json({
        message: "This job is no longer accepting offers.",
      });
    }

    /*
      ------------------------------------
      VALIDATE PRICE
      ------------------------------------
      */

    const offerAmount = Number(amount);

    if (Number.isNaN(offerAmount) || offerAmount < 0) {
      return res.status(400).json({
        message: "Please enter a valid offer amount.",
      });
    }

    /*
      ------------------------------------
      VALIDATE MESSAGE
      ------------------------------------
      */

    if (!message || !message.trim()) {
      return res.status(400).json({
        message: "Please include a short message for the customer.",
      });
    }

    /*
      ------------------------------------
      PREVENT DUPLICATE OFFER
      ------------------------------------
      */

    const existingOffer = await Offer.findOne({
      taskId: task._id,

      providerId: req.userId,
    });

    if (existingOffer) {
      return res.status(400).json({
        message: "You have already sent an offer for this job.",

        offer: existingOffer,
      });
    }

    /*
      ------------------------------------
      CREATE OFFER
      ------------------------------------
      */

    const offer = await Offer.create({
      taskId: task._id,

      providerId: req.userId,

      customerId: task.customerId,

      amount: offerAmount,

      message: message.trim(),

      status: "pending",
    });

    /*
      ------------------------------------
      POPULATE PROVIDER
      ------------------------------------
      */

    await offer.populate("providerId", "fullName location services rating");

    return res.status(201).json({
      success: true,

      message: "Your offer has been sent to the customer.",

      offer,
    });
  } catch (error) {
    console.error("Send offer error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        message: "You have already sent an offer for this job.",
      });
    }

    return res.status(500).json({
      message: "Server error while sending your offer.",
    });
  }
});

/*
========================================
CHECK PROVIDER'S OFFER FOR THIS JOB
GET /api/tasks/:taskId/my-offer
PROVIDER ONLY
========================================
*/

router.get("/:taskId/my-offer", protect, async (req, res) => {
  try {
    const provider = await User.findById(req.userId);

    if (!provider) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can view offers.",
      });
    }

    const offer = await Offer.findOne({
      taskId: req.params.taskId,

      providerId: req.userId,
    });

    return res.status(200).json({
      hasOffer: !!offer,

      offer: offer || null,
    });
  } catch (error) {
    console.error("Load provider offer error:", error);

    return res.status(500).json({
      message: "Server error while loading your offer.",
    });
  }
});

/*
========================================
GET OFFERS FOR CUSTOMER TASK
GET /api/tasks/:taskId/offers
CUSTOMER OWNER ONLY
========================================
*/

router.get("/:taskId/offers", protect, async (req, res) => {
  try {
    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can view offers.",
      });
    }

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    if (task.customerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        message: "You are not authorized to view offers for this task.",
      });
    }

    const offers = await Offer.find({
      taskId: task._id,
    })
      .populate("providerId", "fullName location services rating phone")
      .sort({
        createdAt: -1,
      });

    return res.status(200).json({
      task,
      count: offers.length,

      offers,
    });
  } catch (error) {
    console.error("Load task offers error:", error);

    return res.status(500).json({
      message: "Server error while loading offers.",
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
    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can view matching providers.",
      });
    }

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

/*
========================================
GET ONE JOB
GET /api/tasks/:taskId
========================================
*/

router.get("/:taskId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

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
      PROVIDER
      */

    if (user.role === "provider") {
      if (
        task.status !== "open" &&
        task.assignedProviderId?.toString() !== req.userId.toString()
      ) {
        return res.status(403).json({
          message: "This job is no longer available.",
        });
      }

      return res.status(200).json(task);
    }

    /*
      CUSTOMER
      */

    if (user.role === "customer") {
      const customerId = task.customerId?._id
        ? task.customerId._id.toString()
        : task.customerId.toString();

      if (customerId !== req.userId.toString()) {
        return res.status(403).json({
          message: "You are not authorized to view this task.",
        });
      }

      return res.status(200).json(task);
    }

    return res.status(403).json({
      message: "Not authorized.",
    });
  } catch (error) {
    console.error("Load task error:", error);

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

module.exports = router;
