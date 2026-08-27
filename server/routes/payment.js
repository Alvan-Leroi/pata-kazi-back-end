const express = require("express");

const Task = require("../models/Task");
const Offer = require("../models/Offer");
const Payment = require("../models/Payment");

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

  let clean = phoneNumber.toString().replace(/\s+/g, "").replace(/-/g, "");

  if (clean.startsWith("+254")) {
    clean = clean.substring(1);
  }

  if (clean.startsWith("0")) {
    clean = `254${clean.substring(1)}`;
  }

  if (clean.startsWith("7")) {
    clean = `254${clean}`;
  }

  if (clean.startsWith("1")) {
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
    console.error("M-PESA auth response:", data);

    throw new Error(
      data.errorMessage ||
        data.error_description ||
        "Unable to obtain M-PESA access token.",
    );
  }

  return data.access_token;
};

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
START M-PESA PAYMENT

POST
/api/payments/mpesa/stk-push
========================================
*/

router.post("/mpesa/stk-push", protect, async (req, res) => {
  let createdPayment = null;

  try {
    const { taskId, phoneNumber } = req.body;

    if (!taskId || !phoneNumber) {
      return res.status(400).json({
        message: "Task ID and phone number are required.",
      });
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    if (!normalizedPhone) {
      return res.status(400).json({
        message: "Enter a valid Kenyan phone number, for example 0712345678.",
      });
    }

    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({
        message: "Task not found.",
      });
    }

    /*
      Only the customer who owns
      the task may initiate payment.
      */

    if (task.customerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        message: "You are not authorized to pay for this task.",
      });
    }

    if (!["assigned", "in-progress"].includes(task.status)) {
      return res.status(400).json({
        message: "Payment is only available for an assigned active job.",
      });
    }

    if (!task.assignedProviderId) {
      return res.status(400).json({
        message: "No provider has been assigned to this task.",
      });
    }

    /*
      Get the accepted offer.

      Payment uses the ACCEPTED
      OFFER amount, not the original
      task budget.
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

    const amount = Math.round(Number(acceptedOffer.amount));

    if (!amount || amount < 1) {
      return res.status(400).json({
        message: "The payment amount is invalid.",
      });
    }

    /*
      Prevent another payment if
      this task is already paid.
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
      Create local pending
      transaction first.
      */

    createdPayment = await Payment.create({
      taskId: task._id,

      customerId: task.customerId,

      providerId: task.assignedProviderId,

      amount,

      phoneNumber: normalizedPhone,

      status: "pending",
    });

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

    console.log("Sending M-PESA STK Push:", {
      taskId: task._id.toString(),

      amount,

      phoneNumber: normalizedPhone,

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

    createdPayment.merchantRequestId = mpesaData.MerchantRequestID || "";

    createdPayment.checkoutRequestId = mpesaData.CheckoutRequestID || "";

    createdPayment.resultDescription =
      mpesaData.ResponseDescription || "STK Push sent.";

    await createdPayment.save();

    return res.status(200).json({
      success: true,

      message: "M-PESA payment request sent to the phone.",

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

IMPORTANT:
Do NOT add auth middleware here.

Safaricom must be able to reach
this endpoint directly.
========================================
*/

router.post("/mpesa/callback", async (req, res) => {
  try {
    /*
      Immediately inspect the
      callback Safaricom sent.
      */

    console.log("M-PESA callback received:");

    console.log(JSON.stringify(req.body, null, 2));

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.warn("Invalid M-PESA callback body.");

      /*
        Still return 200 so the
        callback endpoint itself
        remains reachable.
        */

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
      Locate the pending payment
      created during STK Push.
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
      ResultCode 0 means payment
      completed successfully.
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
        Examples include customer
        cancellation or failed PIN.
        */

      payment.status = resultCode === 1032 ? "cancelled" : "failed";

      console.log(`Payment ${payment._id} marked ${payment.status}`);
    }

    await payment.save();

    /*
      Notify frontend clients
      through the Socket.IO server
      we already use for chat.
      */

    const io = req.app.get("io");

    if (io) {
      io.emit("payment_updated", {
        paymentId: payment._id,

        taskId: payment.taskId,

        status: payment.status,

        amount: payment.amount,

        mpesaReceiptNumber: payment.mpesaReceiptNumber,
      });
    }

    /*
      Acknowledge callback.
      */

    return res.status(200).json({
      ResultCode: 0,

      ResultDesc: "Callback processed successfully.",
    });
  } catch (error) {
    console.error("M-PESA callback error:", error);

    /*
      Keep endpoint responsive.
      */

    return res.status(200).json({
      ResultCode: 0,

      ResultDesc: "Callback received.",
    });
  }
});

/*
========================================
CHECK PAYMENT STATUS

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
