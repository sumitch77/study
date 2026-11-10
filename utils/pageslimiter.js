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
  limit: 40,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait a minute"),
});

module.exports = { generallimiter };
