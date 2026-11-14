const express = require("express");
const path = require("path");
const routerdopractice = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");
const {
  client,
  cacheData,
  clearUserDashboardCache,
  clearPublicDashboardCache,
} = require("../utils/redisHelper");
const {
  dopracticelimiter,
  generallimiter,
  highlimiter,
  maxlimiter,
} = require("../utils/dopracticelimiter");

routerdopractice.get(
  "/dopractice",
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    return res.sendFile(path.join(__dirname, "../views/dopractice.html"));
  },
);

const QUESTIONS_PER_TEST = 50;
const TESTS_PER_CHAPTER = 2;

// base = ids used by the subjects stored before it in the table
const SUBJECT_LAYOUT = {
  civics: { base: 0, chapters: 5 },
  economics: { base: 500, chapters: 5 },
  history: { base: 1000, chapters: 5 },
  geography: { base: 1500, chapters: 7 },
};

routerdopractice.get(
  "/getpracticequestions",
  loginother,
  dopracticelimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    const subject = String(req.query.subject || "")
      .trim()
      .toLowerCase();
    const chapter = parseInt(req.query.chapter, 10);
    const test = parseInt(req.query.test, 10);

    const layout = Object.hasOwn(SUBJECT_LAYOUT, subject)
      ? SUBJECT_LAYOUT[subject]
      : null;

    if (
      !layout ||
      !Number.isInteger(chapter) ||
      chapter < 1 ||
      chapter > layout.chapters ||
      !Number.isInteger(test) ||
      test < 1 ||
      test > TESTS_PER_CHAPTER
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Request" });
    }

    const isPremium = req.session.premium === true;

    // free users: chapter 1 only (tests 1 and 2)
    if (!isPremium && chapter > 1) {
      return res
        .status(403)
        .json({ success: false, message: "Premium required" });
    }

    const startId =
      layout.base +
      (chapter - 1) * TESTS_PER_CHAPTER * QUESTIONS_PER_TEST +
      (test - 1) * QUESTIONS_PER_TEST +
      1;
    const endId = startId + QUESTIONS_PER_TEST - 1;

    try {
      const data = await cacheData(
        `practicequestions:${subject}:${chapter}:${test}`,
        600, // 10 minutes
        async () => {
          const { data, error } = await supabase
            .schema("study")
            .from("practicequestion10th") // your table name
            .select(
              "question, option_a, option_b, option_c, option_d, answer, explanation",
            )
            .gte("id", startId)
            .lte("id", endId)
            .order("id", { ascending: true });
          if (error) throw error;
          return data;
        },
        (data) => Array.isArray(data) && data.length > 0,
      );

      if (!data || data.length === 0) {
        return res.json({ success: false, message: "No data found" });
      }

      return res.json({ success: true, data, premium: isPremium });
    } catch (error) {
      console.error("Error fetching data from Supabase:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching data" });
    }
  },
);

module.exports = { routerdopractice };
