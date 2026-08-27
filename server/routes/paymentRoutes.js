const express = require("express");

const Task = require("../models/Task");
const Offer = require("../models/Offer");
const Payment = require("../models/Payment");
const User = require("../models/User");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

/*
========================================
HELPERS
========================================
*/

const getMpesaBaseUrl = () => {
  if (process.env.MPESA_ENVIRONMENT === "production") {
    return "https://api.safaricom.co.ke";
  }

  return "https://sandbox.safaricom.co.ke";
};

const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) {
    return null;
  }

  let clean = phoneNumber
    .toString()
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (clean.startsWith("+254")) {
    clean = clean.substring(1);
  }

  if (clean.startsWith("0")) {
    clean = `254${clean.substring(1)}`;
  }

  if (clean.startsWith("7") || clean.startsWith("1")) {
    clean = `254${clean}`;
  }

  if (!/^254\d{9}$/.test(clean)) {
    return null;
  }

  return clean;
};

const createTimestamp = () => {
  const now = new Date();

  const pad = (value) => value.toString().padStart(2, "0");

  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
};

const getMpesaAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;

  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error("M-PESA consumer credentials are missing.");
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64",
  );

  const baseUrl = getMpesaBaseUrl();

  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",

      headers: {
        Authorization: `Basic ${credentials}`,
      },
    },
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid response from M-PESA authorization service: ${text}`,
    );
  }

  if (!response.ok || !data.access_token) {
    console.error("M-PESA authorization response:", data);

    throw new Error(
      data.errorMessage ||
        data.error_description ||
        "Unable to obtain M-PESA access token.",
    );
  }

  return data.access_token;
};

const getCallbackMetadata = (callback) => {
  const items = callback?.CallbackMetadata?.Item || [];

  const result = {};

  items.forEach((item) => {
    if (item?.Name) {
      result[item.Name] = item.Value;
    }
  });

  return result;
};

/*
========================================
REQUEST CUSTOMER PAYMENT

POST
/api/payments/mpesa/stk-push

IMPORTANT FLOW:

Logged-in user:
PROVIDER

STK recipient:
CUSTOMER

The provider initiates the payment
request.

The backend fetches the customer's
phone number from MongoDB.

The provider never types or controls
the customer's phone number.
========================================
*/

router.post("/mpesa/stk-push", protect, async (req, res) => {
  let createdPayment = null;

  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({
        message: "Task ID is required.",
      });
    }

    /*
      ========================================
      LOAD PROVIDER
      ========================================
      */

    const provider = await User.findById(req.userId);

    if (!provider) {
      return res.status(404).json({
        message: "Provider account could not be found.",
      });
    }

    if (provider.role !== "provider") {
      return res.status(403).json({
        message: "Only service providers can request payment.",
      });
    }

    /*
      ========================================
      LOAD TASK + CUSTOMER
      ========================================
      */

    const task = await Task.findById(taskId).populate(
      "customerId",
      "fullName phone email role",
    );

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    /*
      ========================================
      VERIFY PROVIDER IS ASSIGNED
      ========================================
      */

    if (!task.assignedProviderId) {
      return res.status(400).json({
        message: "No provider has been assigned to this task.",
      });
    }

    if (task.assignedProviderId.toString() !== provider._id.toString()) {
      return res.status(403).json({
        message: "You are not the assigned provider for this task.",
      });
    }

    /*
      ========================================
      VERIFY ACTIVE JOB
      ========================================
      */

    if (!["assigned", "in-progress"].includes(task.status)) {
      return res.status(400).json({
        message: "Payment can only be requested for an active assigned job.",
      });
    }

    /*
      ========================================
      GET CUSTOMER
      ========================================
      */

    const customer = task.customerId;

    if (!customer) {
      return res.status(404).json({
        message: "Customer account could not be found.",
      });
    }

    const customerPhone = normalizePhoneNumber(customer.phone);

    if (!customerPhone) {
      return res.status(400).json({
        message:
          "The customer does not have a valid Kenyan phone number saved.",
      });
    }

    /*
      ========================================
      GET ACCEPTED OFFER
      ========================================
      */

    const acceptedOffer = await Offer.findOne({
      taskId: task._id,

      providerId: provider._id,

      status: "accepted",
    });

    if (!acceptedOffer) {
      return res.status(400).json({
        message: "Accepted offer could not be found.",
      });
    }

    const amount = Math.round(Number(acceptedOffer.amount));

    if (!amount || amount < 1) {
      return res.status(400).json({
        message: "The payment amount is invalid.",
      });
    }

    /*
      ========================================
      PREVENT DUPLICATE PAID PAYMENT
      ========================================
      */

    const existingPaidPayment = await Payment.findOne({
      taskId: task._id,

      status: "paid",
    });

    if (existingPaidPayment) {
      return res.status(400).json({
        message: "This task has already been paid for.",
      });
    }

    /*
      ========================================
      PREVENT MULTIPLE ACTIVE STK REQUESTS
      ========================================
      */

    const existingPendingPayment = await Payment.findOne({
      taskId: task._id,

      status: "pending",
    });

    if (existingPendingPayment) {
      return res.status(400).json({
        message: "A payment request is already pending for this task.",
      });
    }

    /*
      ========================================
      CREATE PAYMENT
      ========================================
      */

    createdPayment = await Payment.create({
      taskId: task._id,

      customerId: customer._id,

      providerId: provider._id,

      amount,

      phoneNumber: customerPhone,

      status: "pending",
    });

    /*
      ========================================
      M-PESA SETTINGS
      ========================================
      */

    const shortcode = process.env.MPESA_SHORTCODE;

    const passkey = process.env.MPESA_PASSKEY;

    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!shortcode || !passkey || !callbackUrl) {
      throw new Error("M-PESA shortcode, passkey, or callback URL is missing.");
    }

    const timestamp = createTimestamp();

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
      "base64",
    );

    const accessToken = await getMpesaAccessToken();

    const baseUrl = getMpesaBaseUrl();

    const accountReference = `PK-${task._id.toString().slice(-8)}`;

    /*
      ========================================
      STK PUSH

      CUSTOMER receives prompt.
      PROVIDER initiated request.
      ========================================
      */

    const requestBody = {
      BusinessShortCode: shortcode,

      Password: password,

      Timestamp: timestamp,

      TransactionType: "CustomerPayBillOnline",

      Amount: amount,

      PartyA: customerPhone,

      PartyB: shortcode,

      PhoneNumber: customerPhone,

      CallBackURL: callbackUrl,

      AccountReference: accountReference,

      TransactionDesc: "Pata Kazi service payment",
    };

    console.log("Provider requesting M-PESA payment:", {
      taskId: task._id.toString(),

      providerId: provider._id.toString(),

      providerName: provider.fullName,

      customerId: customer._id.toString(),

      customerName: customer.fullName,

      customerPhone,

      amount,
    });

    const mpesaResponse = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,

          "Content-Type": "application/json",
        },

        body: JSON.stringify(requestBody),
      },
    );

    const mpesaText = await mpesaResponse.text();

    let mpesaData;

    try {
      mpesaData = JSON.parse(mpesaText);
    } catch {
      throw new Error(`Invalid response from M-PESA: ${mpesaText}`);
    }

    console.log("M-PESA STK Push response:", mpesaData);

    if (!mpesaResponse.ok || mpesaData.ResponseCode !== "0") {
      createdPayment.status = "failed";

      createdPayment.resultDescription =
        mpesaData.errorMessage ||
        mpesaData.ResponseDescription ||
        "M-PESA rejected the payment request.";

      await createdPayment.save();

      return res.status(400).json({
        message: createdPayment.resultDescription,
      });
    }

    createdPayment.merchantRequestId = mpesaData.MerchantRequestID || "";

    createdPayment.checkoutRequestId = mpesaData.CheckoutRequestID || "";

    createdPayment.resultDescription =
      mpesaData.ResponseDescription || "Payment request sent.";

    await createdPayment.save();

    /*
      ========================================
      SOCKET NOTIFICATIONS
      ========================================
      */

    const io = req.app.get("io");

    if (io) {
      /*
        Tell customer that provider
        requested payment.
        */

      io.to(`user:${customer._id}`).emit("payment_requested", {
        paymentId: createdPayment._id,

        taskId: task._id,

        providerId: provider._id,

        providerName: provider.fullName,

        amount,

        status: "pending",
      });

      /*
        Provider receives confirmation
        that request was sent.
        */

      io.to(`user:${provider._id}`).emit("payment_request_sent", {
        paymentId: createdPayment._id,

        taskId: task._id,

        customerName: customer.fullName,

        amount,

        status: "pending",
      });
    }

    return res.status(200).json({
      success: true,

      message: "Payment request sent to the customer.",

      paymentId: createdPayment._id,

      checkoutRequestId: createdPayment.checkoutRequestId,

      amount,

      customerName: customer.fullName,

      customerPhone: customerPhone,

      status: createdPayment.status,
    });
  } catch (error) {
    console.error("M-PESA STK Push error:", error);

    if (createdPayment && createdPayment.status === "pending") {
      createdPayment.status = "failed";

      createdPayment.resultDescription = error.message;

      await createdPayment.save().catch(() => {});
    }

    return res.status(500).json({
      message: error.message || "Server error while requesting payment.",
    });
  }
});

/*
========================================
M-PESA CALLBACK

POST
/api/payments/mpesa/callback
========================================
*/

router.post("/mpesa/callback", async (req, res) => {
  try {
    console.log("M-PESA callback received:");

    console.log(JSON.stringify(req.body, null, 2));

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback received.",
      });
    }

    const checkoutRequestId = callback.CheckoutRequestID;

    const merchantRequestId = callback.MerchantRequestID;

    const resultCode = Number(callback.ResultCode);

    const resultDescription = callback.ResultDesc || "";

    const payment = await Payment.findOne({
      $or: [
        {
          checkoutRequestId,
        },

        {
          merchantRequestId,
        },
      ],
    });

    if (!payment) {
      console.warn("No local payment matched callback.");

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback received.",
      });
    }

    payment.resultCode = resultCode;

    payment.resultDescription = resultDescription;

    payment.rawCallback = req.body;

    if (resultCode === 0) {
      const metadata = getCallbackMetadata(callback);

      payment.status = "paid";

      payment.mpesaReceiptNumber = metadata.MpesaReceiptNumber || "";

      payment.transactionDate = metadata.TransactionDate
        ? String(metadata.TransactionDate)
        : "";

      if (metadata.Amount) {
        payment.amount = Number(metadata.Amount);
      }

      if (metadata.PhoneNumber) {
        payment.phoneNumber = String(metadata.PhoneNumber);
      }
    } else {
      payment.status = resultCode === 1032 ? "cancelled" : "failed";
    }

    await payment.save();

    /*
      ========================================
      NOTIFY BOTH CUSTOMER + PROVIDER
      ========================================
      */

    const io = req.app.get("io");

    const update = {
      paymentId: payment._id,

      taskId: payment.taskId,

      status: payment.status,

      amount: payment.amount,

      mpesaReceiptNumber: payment.mpesaReceiptNumber,
    };

    if (io) {
      io.to(`user:${payment.customerId}`).emit("payment_updated", update);

      io.to(`user:${payment.providerId}`).emit("payment_updated", update);
    }

    return res.status(200).json({
      ResultCode: 0,

      ResultDesc: "Callback processed successfully.",
    });
  } catch (error) {
    console.error("M-PESA callback error:", error);

    return res.status(200).json({
      ResultCode: 0,

      ResultDesc: "Callback received.",
    });
  }
});

/*
========================================
GET PAYMENT STATUS

GET
/api/payments/task/:taskId
========================================
*/

router.get("/task/:taskId", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    const currentUserId = req.userId.toString();

    const customerId = task.customerId?.toString();

    const providerId = task.assignedProviderId?.toString();

    if (currentUserId !== customerId && currentUserId !== providerId) {
      return res.status(403).json({
        message: "You are not authorized to view this payment.",
      });
    }

    const payment = await Payment.findOne({
      taskId: task._id,
    })
      .sort({
        createdAt: -1,
      })
      .select("-rawCallback");

    return res.status(200).json({
      payment: payment || null,
    });
  } catch (error) {
    console.error("Payment status error:", error);

    return res.status(500).json({
      message: "Server error while loading payment.",
    });
  }
});

module.exports = router;
