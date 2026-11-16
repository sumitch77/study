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

const premiumlimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany(
    "Too Many requests from this account ,please Try again later after 1 minute",
  ),
});

const utrlimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait a minute"),
});

const userinfolimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait a minute"),
});

const leaderboardlimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany(
    "Too Many requests from this account ,please Try again later after 5 minutes",
  ),
});

const allleaderboardlimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait few minutes"),
});
const leaderboardpagelimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait few minutes"),
});

const progresslimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.session?.email,

  handler: tooMany("Too Many requests from this account , wait few minutes"),
});

module.exports = {
  premiumlimiter,
  utrlimiter,
  userinfolimiter,
  leaderboardlimiter,
  allleaderboardlimiter,
  progresslimiter,
  leaderboardpagelimiter,
};
