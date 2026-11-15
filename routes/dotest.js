const express = require("express");
const path = require("path");
const routerdotest = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");
const { cacheData } = require("../utils/redisHelper");
const {
  generallimiter,
  highlimiter,
  maxlimiter,
  dotestlimiter,
} = require("../utils/dotestlimiter");

routerdotest.get(
  "/dotest",
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    return res.sendFile(path.join(__dirname, "../views/dotest.html"));
  },
);

const QUESTIONS_PER_TEST = 100;
const TESTS_PER_SUBJECT = 2;

// base = ids used by the subjects stored before it in the table
// table order: geography (test1 = 100, test2 = 100), civics, economics, history
const SUBJECT_LAYOUT = {
  geography: { base: 0 },
  civics: { base: 200 },
  economics: { base: 400 },
  history: { base: 600 },
};

routerdotest.get(
  "/gettestquestions",
  loginother,
  dotestlimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    const subject = String(req.query.subject || "")
      .trim()
      .toLowerCase();
    const test = parseInt(req.query.test, 10);

    const layout = Object.hasOwn(SUBJECT_LAYOUT, subject)
      ? SUBJECT_LAYOUT[subject]
      : null;

    if (
      !layout ||
      !Number.isInteger(test) ||
      test < 1 ||
      test > TESTS_PER_SUBJECT
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Request" });
    }

    // full subject tests are premium only (checked BEFORE the cache / database)
    if (req.session.premium !== true) {
      return res
        .status(403)
        .json({ success: false, message: "Premium required" });
    }

    const startId = layout.base + (test - 1) * QUESTIONS_PER_TEST + 1;
    const endId = startId + QUESTIONS_PER_TEST - 1;

    try {
      const data = await cacheData(
        `testquestions:${subject}:${test}`,
        600, // 10 minutes
        async () => {
          const { data, error } = await supabase
            .schema("study")
            .from("testquestion10th")
            .select(
              "question, option_a, option_b, option_c, option_d, answer, explanation",
            )
            .gte("id", startId)
            .lte("id", endId)
            .order("id", { ascending: true });
          if (error) throw error;
          return data;
        },
        // only cache a complete test
        (d) => Array.isArray(d) && d.length === QUESTIONS_PER_TEST,
      );

      if (!data || data.length === 0) {
        return res.json({ success: false, message: "No data found" });
      }

      // never send a half-filled test: the score is out of 100
      if (data.length !== QUESTIONS_PER_TEST) {
        console.error("gettestquestions: incomplete test", {
          subject,
          test,
          startId,
          endId,
          got: data.length,
        });
        return res
          .status(404)
          .json({ success: false, message: "Test not available yet" });
      }

      return res.json({ success: true, data, premium: true });
    } catch (error) {
      console.error("Error fetching data from Supabase:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching data" });
    }
  },
);

module.exports = {
  routerdotest,
  SUBJECT_LAYOUT,
  QUESTIONS_PER_TEST,
  TESTS_PER_SUBJECT,
};
