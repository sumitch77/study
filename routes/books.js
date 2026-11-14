const express = require("express");
const path = require("path");
const routerbooks = express.Router();
const dotenv = require("dotenv");
dotenv.config();

const {
  booklimiter,
  generallimiter,
  highlimiter,
  maxlimiter,
} = require("../utils/booklimiter");
const { cacheData } = require("../utils/redisHelper");

const { type } = require("os");
const { supabase } = require("../utils/supabase");
const { loginother } = require("../utils/helper");

routerbooks.get(
  ["/books"],
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    return res.sendFile(path.join(__dirname, "../views/book.html"));
  },
);

routerbooks.get(
  "/getsubjects",
  loginother,
  generallimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    if (req.session.class === "10") {
      const subjects = [
        "Maths",
        "Science",
        "Social Science",
        "English",
        "Hindi",
      ];
      return res.status(200).json({ success: true, subjects: subjects });
    }
  },
);
routerbooks.get(
  "/getbooks",
  loginother,
  booklimiter,
  highlimiter,
  maxlimiter,
  async (req, res) => {
    const subject = String(req.query.subject || "")
      .trim()
      .toLowerCase();
    const userClass = req.session.class;

    if (!subject || subject.length > 50 || userClass == null) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Request" });
    }

    try {
      const books = await cacheData(
        `books:${userClass}:${subject}`,
        600, // 10 minutes
        async () => {
          const { data, error } = await supabase
            .schema("study")
            .from("books")
            .select("*")
            .eq("mainsub", subject)
            .eq("class", userClass);
          if (error) throw error;
          return data;
        },
        (data) => Array.isArray(data) && data.length > 0,
      );

      return res.status(200).json({ success: true, books });
    } catch (error) {
      console.error("Error fetching data from Supabase:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error fetching data" });
    }
  },
);

module.exports = { routerbooks };
