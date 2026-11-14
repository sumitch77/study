const express = require("express");
const { check, validationResult } = require("express-validator");
const { link } = require("fs");
let rateLimit = require("express-rate-limit");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const ipaddr = require("ipaddr.js");
const { ipKeyGenerator } = require("express-rate-limit");

const tooMany = (msg) => (req, res) =>
  res.render("error2", {
    errorType: "Too Many Requests",
    errorCode: 429,
    errorMessage: msg,
  });

const practicelimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany(
    "Too Many requests from this account ,please Try again later after 1 minute",
  ),
});

const generallimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait a minute"),
});

const highlimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 50,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany(
    "Too Many requests from this account ,please Try again later after 5 minutes",
  ),
});

const maxlimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait few minutes"),
});

module.exports = { practicelimiter, generallimiter, highlimiter, maxlimiter };
