const express = require("express");
const path = require("path");
const routertest = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");
const { cacheData } = require("../utils/redisHelper");
const {
  testlimiter,
  generallimiter,
  highlimiter,
  maxlimiter,
} = require("../utils/testlimiter");
// the page
routertest.get(
  "/test",
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    return res.sendFile(path.join(__dirname, "../views/test.html"));
  },
);

// the list of full subject tests (2 per subject)
routertest.get(
  "/ssctest",
  loginother,
  testlimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    const subject = String(req.query.subject || "")
      .trim()
      .toLowerCase();

    // letters and spaces only: no % or _ wildcards reach ilike
    if (!/^[a-z ]{1,30}$/.test(subject)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Request" });
    }

    try {
      // same rows for everyone, so one cache key per subject
      const data = await cacheData(
        `ssctest:${subject}`,
        600,
        async () => {
          const { data, error } = await supabase
            .schema("study")
            .from("ssctest")
            .select("*")
            .ilike("subject", subject);
          if (error) throw error;
          return data;
        },
        (d) => Array.isArray(d) && d.length > 0,
      );

      if (!data || data.length === 0) {
        return res.json({ success: false, message: "No data found" });
      }

      // premium === false -> test.html shows the tests locked (chain + /premium link)
      return res.json({
        success: true,
        data,
        premium: req.session.premium === true,
      });
    } catch (error) {
      console.error("Error fetching tests from Supabase:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching data" });
    }
  },
);

module.exports = { routertest };
