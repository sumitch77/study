const express = require("express");
const path = require("path");
const routerbooks = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { Resend } = require("resend");
const resendClient = new Resend(process.env.TOKEN);
const { check } = require("express-validator");
const { EmailLimiter, TimeLimiter, validate } = require("../utils/ratelimit");

const { type } = require("os");
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");

routerbooks.get("/getsubjects", loginother, async (req, res) => {
  if (req.session.class === "10") {
    const subjects = ["Maths", "Science", "Social Science", "English", "Hindi"];
    return res.status(200).json({ success: true, subjects: subjects });
  }
});

routerbooks.get("/getbooks", loginother, async (req, res) => {
  let { subject } = req.query;
  subject = subject?.toLowerCase();

  if (!subject) {
    return res.status(400).json({ success: false, message: "Invalid Request" });
  }
  const { data, error } = await supabase
    .schema("study")
    .from("books")
    .select("*")
    .eq("mainsub", subject)
    .eq("class", req.session.class);
  if (error) {
    console.error("Error fetching data from Supabase:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching data" });
  }
  return res.status(200).json({ success: true, books: data });
});

module.exports = { routerbooks };
