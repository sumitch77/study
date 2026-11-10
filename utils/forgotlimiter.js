const express = require("express");
const rateLimit = require("express-rate-limit");
const { check, validationResult } = require("express-validator");
const { link } = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const ipaddr = require("ipaddr.js");
const { ipKeyGenerator } = require("express-rate-limit");

const tooMany = (msg) => (req, res) => res.status(429).json({ message: msg });

const generallimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip) || "none";
    return crypto.createHash("sha256").update(`${ip}`).digest("hex");
  },
  handler: tooMany("Too Many requests from this IP"),
});

const forgotlimitter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 2,
  keyGenerator: (req) => {
    const email = canonicalEmail(req.body?.email) || "";
    return crypto.createHash("sha256").update(`${email}`).digest("hex");
  },
  handler: tooMany("Invalid Email or Too Many requests"),
});

const forgotiplimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 50,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip);
    return crypto.createHash("sha256").update(`${ip}`).digest("hex");
  },
  handler: tooMany("Too Many requests from this IP"),
});

module.exports = { forgotiplimiter, forgotlimitter };
