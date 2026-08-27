const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const router = express.Router();

/*
========================================
CREATE JWT TOKEN
========================================
*/

const createToken = (userId) => {
  return jwt.sign(
    {
      userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
};

/*
========================================
REGISTER
POST /api/auth/register
========================================
*/

router.post("/register", async (req, res) => {
  try {
    const { fullName, email, phone, password, role } = req.body;

    /*
    -------------------------------------
    Validate required fields
    -------------------------------------
    */

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({
        message: "Please complete all required fields.",
      });
    }

    /*
    -------------------------------------
    Validate password
    -------------------------------------
    */

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters.",
      });
    }

    /*
    -------------------------------------
    Normalize email
    -------------------------------------
    */

    const normalizedEmail = email.trim().toLowerCase();

    /*
    -------------------------------------
    Check for existing account
    -------------------------------------
    */

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(400).json({
        message: "An account with this email already exists.",
      });
    }

    /*
    -------------------------------------
    Validate role
    -------------------------------------
    */

    const userRole = role === "provider" ? "provider" : "customer";

    /*
    -------------------------------------
    Hash password
    -------------------------------------
    */

    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(password, salt);

    /*
    -------------------------------------
    Create user
    -------------------------------------
    */

    const user = await User.create({
      fullName: fullName.trim(),

      email: normalizedEmail,

      phone: phone.trim(),

      password: hashedPassword,

      role: userRole,
    });

    /*
    -------------------------------------
    Create login token
    -------------------------------------
    */

    const token = createToken(user._id);

    /*
    -------------------------------------
    Send safe user information
    -------------------------------------
    */

    return res.status(201).json({
      success: true,

      message: "Account created successfully.",

      token,

      user: {
        _id: user._id,

        fullName: user.fullName,

        email: user.email,

        phone: user.phone,

        role: user.role,

        location: user.location,

        services: user.services || [],

        rating: user.rating || 0,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Server error while creating account.",
    });
  }
});

/*
========================================
LOGIN
POST /api/auth/login
========================================
*/

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    /*
    -------------------------------------
    Validate input
    -------------------------------------
    */

    if (!email || !password) {
      return res.status(400).json({
        message: "Please enter your email and password.",
      });
    }

    /*
    -------------------------------------
    Find user
    -------------------------------------
    */

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    /*
    -------------------------------------
    Check password
    -------------------------------------
    */

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    /*
    -------------------------------------
    Generate token
    -------------------------------------
    */

    const token = createToken(user._id);

    /*
    -------------------------------------
    Return token and user
    -------------------------------------
    */

    return res.status(200).json({
      success: true,

      message: "Login successful.",

      token,

      user: {
        _id: user._id,

        fullName: user.fullName,

        email: user.email,

        phone: user.phone,

        role: user.role,

        location: user.location,

        services: user.services || [],

        rating: user.rating || 0,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Server error while signing in.",
    });
  }
});

module.exports = router;
