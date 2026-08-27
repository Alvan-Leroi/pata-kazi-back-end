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

/*
========================================
NORMALIZE KENYAN PHONE NUMBER

Examples:

0712345678
    ↓
254712345678

+254712345678
    ↓
254712345678

254712345678
    ↓
254712345678
========================================
*/

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

/*
========================================
CREATE M-PESA TIMESTAMP
YYYYMMDDHHMMSS
========================================
*/

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

/*
========================================
GET M-PESA ACCESS TOKEN
========================================
*/

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

/*
========================================
CALLBACK METADATA HELPER
========================================
*/

const getCallbackMetadata = (callback) => {
  const metadataItems = callback?.CallbackMetadata?.Item || [];

  const result = {};

  metadataItems.forEach((item) => {
    if (item?.Name) {
      result[item.Name] = item.Value;
    }
  });

  return result;
};

/*
========================================
START M-PESA STK PUSH

POST
/api/payments/mpesa/stk-push

IMPORTANT:

We DO NOT trust a provider phone
or random client-side account value.

We load the currently authenticated
CUSTOMER from MongoDB and use that
customer's saved phone number.
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
      LOAD LOGGED-IN CUSTOMER
      ========================================
      */

    const customer = await User.findById(req.userId);

    if (!customer) {
      return res.status(404).json({
        message: "Customer account could not be found.",
      });
    }

    if (customer.role !== "customer") {
      return res.status(403).json({
        message: "Only customers can make payments.",
      });
    }

    /*
      ========================================
      CUSTOMER PHONE NUMBER
      ========================================
      */

    const normalizedPhone = normalizePhoneNumber(customer.phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        message:
          "Your Pata Kazi account does not have a valid Kenyan phone number. Please update your customer phone number before paying.",
      });
    }

    /*
      ========================================
      LOAD TASK
      ========================================
      */

    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    /*
      ========================================
      VERIFY CUSTOMER OWNS TASK
      ========================================
      */

    if (task.customerId.toString() !== customer._id.toString()) {
      return res.status(403).json({
        message: "You are not authorized to pay for this task.",
      });
    }

    /*
      ========================================
      VERIFY ACTIVE JOB
      ========================================
      */

    if (!["assigned", "in-progress"].includes(task.status)) {
      return res.status(400).json({
        message: "Payment is only available for an assigned active job.",
      });
    }

    /*
      ========================================
      VERIFY PROVIDER EXISTS
      ========================================
      */

    if (!task.assignedProviderId) {
      return res.status(400).json({
        message: "No provider has been assigned to this task.",
      });
    }

    /*
      ========================================
      GET ACCEPTED OFFER
      ========================================
      */

    const acceptedOffer = await Offer.findOne({
      taskId: task._id,

      providerId: task.assignedProviderId,

      status: "accepted",
    });

    if (!acceptedOffer) {
      return res.status(400).json({
        message: "Accepted provider offer could not be found.",
      });
    }

    /*
      ========================================
      USE ACCEPTED OFFER PRICE
      ========================================
      */

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
      CREATE LOCAL PAYMENT
      ========================================
      */

    createdPayment = await Payment.create({
      taskId: task._id,

      customerId: customer._id,

      providerId: task.assignedProviderId,

      amount,

      /*
          THIS IS THE CUSTOMER NUMBER
          */

      phoneNumber: normalizedPhone,

      status: "pending",
    });

    /*
      ========================================
      M-PESA ENVIRONMENT
      ========================================
      */

    const shortcode = process.env.MPESA_SHORTCODE;

    const passkey = process.env.MPESA_PASSKEY;

    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!shortcode || !passkey || !callbackUrl) {
      throw new Error("M-PESA shortcode, passkey, or callback URL is missing.");
    }

    /*
      ========================================
      CREATE PASSWORD
      ========================================
      */

    const timestamp = createTimestamp();

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
      "base64",
    );

    /*
      ========================================
      ACCESS TOKEN
      ========================================
      */

    const accessToken = await getMpesaAccessToken();

    const baseUrl = getMpesaBaseUrl();

    /*
      ========================================
      ACCOUNT REFERENCE
      ========================================
      */

    const accountReference = `PK-${task._id.toString().slice(-8)}`;

    /*
      ========================================
      M-PESA REQUEST
      ========================================

      PartyA       = CUSTOMER
      PhoneNumber  = CUSTOMER
      PartyB       = BUSINESS SHORTCODE

      Provider number is NOT used here.
      ========================================
      */

    const requestBody = {
      BusinessShortCode: shortcode,

      Password: password,

      Timestamp: timestamp,

      TransactionType: "CustomerPayBillOnline",

      Amount: amount,

      PartyA: normalizedPhone,

      PartyB: shortcode,

      PhoneNumber: normalizedPhone,

      CallBackURL: callbackUrl,

      AccountReference: accountReference,

      TransactionDesc: "Pata Kazi service payment",
    };

    /*
      Safe debug information.

      We log whose payment it is
      without exposing credentials.
      */

    console.log("Sending M-PESA STK Push:", {
      taskId: task._id.toString(),

      customerId: customer._id.toString(),

      customerName: customer.fullName,

      customerPhone: normalizedPhone,

      providerId: task.assignedProviderId.toString(),

      amount,

      accountReference,
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

    /*
      ========================================
      HANDLE REJECTION
      ========================================
      */

    if (!mpesaResponse.ok || mpesaData.ResponseCode !== "0") {
      createdPayment.status = "failed";

      createdPayment.resultDescription =
        mpesaData.errorMessage ||
        mpesaData.ResponseDescription ||
        "M-PESA rejected the payment request.";

      await createdPayment.save();

      return res.status(400).json({
        message: createdPayment.resultDescription,

        payment: createdPayment,
      });
    }

    /*
      ========================================
      SAVE M-PESA IDS
      ========================================
      */

    createdPayment.merchantRequestId = mpesaData.MerchantRequestID || "";

    createdPayment.checkoutRequestId = mpesaData.CheckoutRequestID || "";

    createdPayment.resultDescription =
      mpesaData.ResponseDescription || "STK Push sent.";

    await createdPayment.save();

    /*
      ========================================
      RESPONSE TO FRONTEND
      ========================================
      */

    return res.status(200).json({
      success: true,

      message: "M-PESA payment request sent to your phone.",

      paymentId: createdPayment._id,

      checkoutRequestId: createdPayment.checkoutRequestId,

      amount: createdPayment.amount,

      phoneNumber: createdPayment.phoneNumber,
    });
  } catch (error) {
    console.error("M-PESA STK Push error:", error);

    if (createdPayment && createdPayment.status === "pending") {
      createdPayment.status = "failed";

      createdPayment.resultDescription = error.message;

      await createdPayment.save().catch(() => {});
    }

    return res.status(500).json({
      message: error.message || "Server error while initiating M-PESA payment.",
    });
  }
});

/*
========================================
M-PESA CALLBACK

POST
/api/payments/mpesa/callback

NO JWT AUTH HERE.

Safaricom needs public access
to this URL.
========================================
*/

router.post("/mpesa/callback", async (req, res) => {
  try {
    console.log("M-PESA callback received:");

    console.log(JSON.stringify(req.body, null, 2));

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.warn("Invalid M-PESA callback body.");

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback received.",
      });
    }

    const checkoutRequestId = callback.CheckoutRequestID;

    const merchantRequestId = callback.MerchantRequestID;

    const resultCode = Number(callback.ResultCode);

    const resultDescription = callback.ResultDesc || "";

    /*
      ========================================
      FIND PAYMENT
      ========================================
      */

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
      console.warn("No local payment matched callback:", {
        checkoutRequestId,

        merchantRequestId,
      });

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback received.",
      });
    }

    payment.resultCode = resultCode;

    payment.resultDescription = resultDescription;

    payment.rawCallback = req.body;

    /*
      ========================================
      SUCCESS
      ========================================
      */

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

      console.log(`Payment ${payment._id} marked PAID`);
    } else {
      /*
        Result 1032 is commonly
        customer cancellation.
        */

      payment.status = resultCode === 1032 ? "cancelled" : "failed";

      console.log(`Payment ${payment._id} marked ${payment.status}`);
    }

    await payment.save();

    /*
      ========================================
      REAL-TIME PAYMENT EVENT
      ========================================
      */

    const io = req.app.get("io");

    if (io) {
      io.to(`user:${payment.customerId}`).emit("payment_updated", {
        paymentId: payment._id,

        taskId: payment.taskId,

        status: payment.status,

        amount: payment.amount,

        mpesaReceiptNumber: payment.mpesaReceiptNumber,
      });
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
