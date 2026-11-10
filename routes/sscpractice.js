const express = require("express");
const path = require("path");
const routerssc = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { Resend } = require("resend");
const resendClient = new Resend(process.env.TOKEN);
const { check } = require("express-validator");
const { EmailLimiter, TimeLimiter, validate } = require("../utils/ratelimit");

const { type } = require("os");
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");

routerssc.get("/sscpractice", loginother, async (req, res) => {
  const { subject } = req.query;
  if (!subject) {
    return res.json({ success: false, message: "Invalid Request" });
  }

  const { data, error } = await supabase
    .schema("study")
    .from("sscpractice")
    .select("*")
    .ilike("subject", subject);
  if (error) {
    console.error("Error fetching data from Supabase:", error);
    return res.json({ success: false, message: "Error fetching data" });
  }
  if (!data || data.length === 0) {
    console.error("No data found for the given subject:", subject);
    return res.json({ success: false, message: "No data found" });
  }
  if (data) {
    return res.json({ success: true, data: data });
  }
});

routerssc.get("/paperpractice", loginother, async (req, res) => {
  return res.sendFile(path.join(__dirname, "../views/paper.html"));
});

routerssc.get("/getpaperpractice", loginother, async (req, res) => {
  let { subject, chapter, test } = req.query;
  if (!subject || !chapter || !test) {
    return res.status(400).json({ success: false, message: "Invalid Request" });
  }
  subject = subject.toLowerCase();
  if (subject === "geography") {
    const { data, error } = await supabase
      .schema("study")
      .from("practice_questions")
      .select("*")
      .limit(50);
    if (error) {
      console.error("Error fetching data from Supabase:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching data" });
    }
    if (!data || data.length === 0) {
      console.error("No data found for the given subject:", subject);
      return res.status(404).json({ success: false, message: "No data found" });
    }
    if (data) {
      return res.status(200).json({ success: true, data: data });
    }
  }
});

module.exports = { routerssc };
