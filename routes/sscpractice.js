const express = require("express");
const path = require("path");
const routerssc = express.Router();
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
  practicelimiter,
  generallimiter,
  highlimiter,
  maxlimiter,
} = require("../utils/practicelimiter");

routerssc.get(
  "/practice",
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    return res.sendFile(path.join(__dirname, "../views/practice.html"));
  },
);
routerssc.get(
  "/sscpractice",
  loginother,
  practicelimiter,
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
    if (!req.session.premium) {
      try {
        const data = await cacheData(
          `sscpractice:${subject}:${req.session.premium}`,
          600,
          async () => {
            const { data, error } = await supabase
              .schema("study")
              .from("sscpractice")
              .select("*")
              .ilike("subject", subject)
              .limit(1);
            if (error) throw error;
            return data;
          },
          (data) => Array.isArray(data) && data.length > 0,
        );

        if (!data || data.length === 0) {
          return res.json({ success: false, message: "No data found" });
        }

        return res.json({
          success: true,
          data,
          premium: false,
          total_chapter: 5,
        });
      } catch (error) {
        console.error("Error fetching data from Supabase:", error);
        return res
          .status(500)
          .json({ success: false, message: "Error fetching data" });
      }
    }
    if (req.session.premium) {
      try {
        const data = await cacheData(
          `sscpractice:${subject}:${req.session.premium}`,
          600,
          async () => {
            const { data, error } = await supabase
              .schema("study")
              .from("sscpractice")
              .select("*")
              .ilike("subject", subject);
            if (error) throw error;
            return data;
          },
          (data) => Array.isArray(data) && data.length > 0,
        );

        if (!data || data.length === 0) {
          return res.json({ success: false, message: "No data found" });
        }

        return res.json({ success: true, data, premium: true });
      } catch (error) {
        console.error("Error fetching data from Supabase:", error);
        return res
          .status(500)
          .json({ success: false, message: "Error fetching data" });
      }
    }
  },
);

module.exports = { routerssc };
