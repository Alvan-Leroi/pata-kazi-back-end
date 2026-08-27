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
CUSTOMER - MY TASKS
GET /api/tasks/mine
========================================
*/

router.get("/mine", protect, async (req, res) => {
  try {
    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can view posted tasks.",
      });
    }

    const tasks = await Task.find({
      customerId: req.userId,
    })
      .populate("assignedProviderId", "fullName location services rating")
      .sort({
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
PROVIDER - OPEN JOBS
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
PROVIDER - MY ASSIGNED JOBS
GET /api/tasks/provider/my-jobs
========================================
*/

router.get("/provider/my-jobs", protect, async (req, res) => {
  try {
    const provider = await User.findById(req.userId);

    if (!provider) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can view provider jobs.",
      });
    }

    const tasks = await Task.find({
      assignedProviderId: req.userId,

      status: {
        $in: ["assigned", "in-progress", "completed"],
      },
    })
      .populate("customerId", "fullName location")
      .sort({
        updatedAt: -1,
      });

    /*
      Find the accepted offer for
      each assigned task so we can
      return the agreed price too.
      */

    const jobsWithOffers = await Promise.all(
      tasks.map(async (task) => {
        const acceptedOffer = await Offer.findOne({
          taskId: task._id,

          providerId: req.userId,

          status: "accepted",
        });

        return {
          ...task.toObject(),

          acceptedOffer: acceptedOffer
            ? {
                _id: acceptedOffer._id,

                amount: acceptedOffer.amount,

                message: acceptedOffer.message,

                status: acceptedOffer.status,
              }
            : null,
        };
      }),
    );

    return res.status(200).json(jobsWithOffers);
  } catch (error) {
    console.error("Load provider jobs error:", error);

    return res.status(500).json({
      message: "Server error while loading your jobs.",
    });
  }
});

/*
========================================
SEND OFFER
POST /api/tasks/:taskId/offers
========================================
*/

router.post("/:taskId/offers", protect, async (req, res) => {
  try {
    const { amount, message } = req.body;

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

    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Job not found.",
      });
    }

    if (task.status !== "open") {
      return res.status(400).json({
        message: "This job is no longer accepting offers.",
      });
    }

    const offerAmount = Number(amount);

    if (Number.isNaN(offerAmount) || offerAmount <= 0) {
      return res.status(400).json({
        message: "Please enter a valid offer amount.",
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        message: "Please include a short message for the customer.",
      });
    }

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

    const offer = await Offer.create({
      taskId: task._id,

      providerId: req.userId,

      customerId: task.customerId,

      amount: offerAmount,

      message: message.trim(),

      status: "pending",
    });

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
PROVIDER - MY OFFER
GET /api/tasks/:taskId/my-offer
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
CUSTOMER - GET OFFERS
GET /api/tasks/:taskId/offers
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
      .populate("providerId", "fullName location services rating")
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
CUSTOMER - ACCEPT OFFER
PATCH /api/tasks/:taskId/offers/:offerId/accept
========================================
*/

router.patch("/:taskId/offers/:offerId/accept", protect, async (req, res) => {
  try {
    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can accept offers.",
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
        message: "You are not authorized to manage this task.",
      });
    }

    if (task.status !== "open") {
      return res.status(400).json({
        message: "This task already has a provider assigned.",
      });
    }

    const offer = await Offer.findOne({
      _id: req.params.offerId,

      taskId: task._id,
    });

    if (!offer) {
      return res.status(404).json({
        message: "Offer not found.",
      });
    }

    if (offer.status !== "pending") {
      return res.status(400).json({
        message: "This offer is no longer pending.",
      });
    }

    /*
      Accept winning offer
      */

    offer.status = "accepted";

    await offer.save();

    /*
      Assign provider to task
      */

    task.assignedProviderId = offer.providerId;

    task.status = "assigned";

    await task.save();

    /*
      Decline competing offers
      */

    await Offer.updateMany(
      {
        taskId: task._id,

        _id: {
          $ne: offer._id,
        },

        status: "pending",
      },

      {
        $set: {
          status: "declined",
        },
      },
    );

    await offer.populate("providerId", "fullName location services rating");

    return res.status(200).json({
      success: true,

      message: "Provider selected successfully.",

      task,

      offer,
    });
  } catch (error) {
    console.error("Accept offer error:", error);

    return res.status(500).json({
      message: "Server error while accepting offer.",
    });
  }
});

/*
========================================
CUSTOMER - MATCHING PROVIDERS
GET /api/tasks/:taskId/providers
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
GET ONE TASK
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

    const task = await Task.findById(req.params.taskId)
      .populate("customerId", "fullName location")
      .populate("assignedProviderId", "fullName location services rating");

    if (!task) {
      return res.status(404).json({
        message: "Job not found.",
      });
    }

    /*
      PROVIDER ACCESS
      */

    if (user.role === "provider") {
      const assignedProviderId = task.assignedProviderId?._id?.toString();

      if (task.status === "open") {
        return res.status(200).json(task);
      }

      if (assignedProviderId === req.userId.toString()) {
        return res.status(200).json(task);
      }

      return res.status(403).json({
        message: "This job is no longer available.",
      });
    }

    /*
      CUSTOMER ACCESS
      */

    if (user.role === "customer") {
      const customerId = task.customerId?._id?.toString();

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

    return res.status(500).json({
      message: "Server error while loading job.",
    });
  }
});

module.exports = router;
