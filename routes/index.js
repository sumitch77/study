const express = require("express");
const path = require("path");
const router = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const dns = require("dns");
const crypto = require("crypto");
const { check } = require("express-validator");
const {
  TimeLimiter,
  VaultLimiter,
  validate,
  docupload,
  cloudinary,
} = require("../utils/ratelimit");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const { createProxyMiddleware } = require("http-proxy-middleware");
const { supabase } = require("../utils/supabase");
const { generallimiter } = require("../utils/testlimiter");
const {
  client,
  cacheData,
  clearUserDashboardCache,
  clearPublicDashboardCache,
} = require("../utils/redisHelper");

router.get("/", generallimiter, async (req, res) => {
  if (req.session.userId) {
    return res.sendFile(path.join(__dirname, "../views/index.html"));
  }
  return res.redirect("/login");
});

router.get("/alltime", async (req, res) => {
  return res.status(200).json({ success: true });
});

router.get("/policy", async (req, res) => {
  return res.sendFile(path.join(__dirname, "../public/policy.html"));
});

router.get("/terms", async (req, res) => {
  return res.sendFile(path.join(__dirname, "../public/terms.html"));
});
router.get("/help", async (req, res) => {
  return res.sendFile(path.join(__dirname, "../public/help.html"));
});
router.get("/about", async (req, res) => {
  return res.sendFile(path.join(__dirname, "../public/about.html"));
});
router.get("/sitemap.xml", async (req, res) => {
  return res.sendFile(path.join(__dirname, "../public/sitemap.xml"));
});
// router.get([ "/pyq",], generallimiter, async (req, res) => {
//   if (!req.session.userId) {
//     return res.redirect("/login");
//   }
//   return res.sendFile(path.join(__dirname, "../views/books.html"));
// });

router.get(["/notes"], generallimiter, async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  return res.sendFile(path.join(__dirname, "../views/book.html"));
});
// router.get("/ssc", async (req, res) => {
//   if (req.session.userId) {
//     return res.sendFile(path.join(__dirname, "../views/ssc.html"));
//   }
//   return res.redirect("/login");
// });
// router.get("/subjects", async (req, res) => {
//   if (req.session.userId) {
//     const { data, error } = await supabase
//       .schema("study")
//       .from("subjects")
//       .select("subject, icon, href, bg")
//       .eq("class", req.session.class)
//       .order("id", { ascending: true });

//     if (error) throw error;

//     return res.json(data);
//   }
//   return res.redirect("/login");
// });
router.get("/userinfo", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return res.status(200).json({
    success: true,
    username: req.session.username,
    useremail: req.session.useremail,
  });
});

// ---------- leaderboard (same data for everyone, 10 minutes) ----------
async function fetchLeaderboard(limit) {
  let q = supabase
    .schema("study")
    .from("leaderboard")
    .select("username,totalpractice,totaltest,final_score")
    // nullsFirst:false -> students without a score go last (Postgres puts NULL first on desc)
    .order("final_score", { ascending: false, nullsFirst: false });
  if (limit) q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw error;

  // add the rank here so it is cached together with the list
  return data.map((row, i) => ({ ...row, rank: i + 1 }));
}

router.get("/leaderboard", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const data = await cacheData(
      "leaderboard:top10",
      600,
      () => fetchLeaderboard(10),
      (d) => Array.isArray(d) && d.length > 0, // don't cache an empty list
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});

router.get("/finalleaderboard", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const data = await cacheData(
      "leaderboard:all",
      600,
      () => fetchLeaderboard(null),
      (d) => Array.isArray(d) && d.length > 0,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});

// ---------- progress (per user, 5 minutes) ----------
const PROGRESS_SUBJECTS = ["geography", "civics", "history", "economics"];

async function fetchProgress(useremail) {
  const { data, error } = await supabase
    .schema("study")
    .from("scoretable")
    .select("subject, test_score")
    .eq("useremail", useremail)
    .in("subject", PROGRESS_SUBJECTS);

  if (error) throw error;

  const out = {};
  for (const s of PROGRESS_SUBJECTS) {
    out[s] = { attempted: 0, avgscore: 0, avgpercent: 0, _sum: 0 };
  }

  for (const row of data || []) {
    const bucket = out[String(row.subject).toLowerCase()];
    if (!bucket) continue;
    bucket.attempted += 1;
    bucket._sum += Number(row.test_score) || 0;
  }

  for (const s of PROGRESS_SUBJECTS) {
    const b = out[s];
    // test_score is stored out of 100, so the average is already a percentage
    b.avgscore = b.attempted
      ? Math.round((b._sum / b.attempted) * 100) / 100
      : 0;
    b.avgpercent = b.avgscore;
    delete b._sum;
  }
  return out;
}

const progressKey = (email) => `progress:${email}`;

router.get("/getprogressdata", async (req, res) => {
  if (!req.session.useremail) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const data = await cacheData(
      progressKey(req.session.useremail), // one key per user
      300,
      () => fetchProgress(req.session.useremail),
    );
    return res.json({ success: true, data });
  } catch (err) {
    console.error("getprogressdata error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/allleaderboard", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return res.sendFile(path.join(__dirname, "../views/leaderboard.html"));
});

router.post("/captcha", async (req, res) => {
  const { email, token } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Missing Email." });
  }
  if (!token) {
    return res
      .status(400)
      .json({ success: false, message: "Missing reCAPTCHA token." });
  }

  try {
    const googleVerifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.CAPTCHA}&response=${token}`;

    const response = await fetch(googleVerifyUrl, { method: "POST" });
    const data = await response.json();

    if (data.success && data.score >= 0.5 && data.action === "signup") {
      req.session.captcha = {
        valid: true,
        email,
        issuedAt: Date.now(),
      };
      return res.json({
        success: true,
        message: "Captcha verification successful!",
      });
    } else {
      req.session.captcha = null;
      return res.status(403).json({
        success: false,
        message: "Captcha verification failed , Please try again",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Not your fault ,Internal verification error.",
    });
  }
});

// ---- shared layout (must be the same one /getpracticequestions uses) ----
const SUBJECT_LAYOUT = {
  civics: { start: 1, chapters: 5 },
  economics: { start: 501, chapters: 5 },
  history: { start: 1001, chapters: 5 },
  geography: { start: 1501, chapters: 7 },
};
const QUESTIONS_PER_TEST = 50;
const TESTS_PER_CHAPTER = 2;
const MAX_TEST_SECONDS = 3 * 60 * 60; // sanity cap: 3 hours
const MAX_LEAVES = 3; // same rule as dopractice.html

// Returns the correct answers ("a".."d") for one test, in id order.
// Uses an id range (no offset) and a Redis cache.
async function getCorrectAnswers(subject, chapter, test) {
  const layout = SUBJECT_LAYOUT[subject];
  const firstId =
    layout.start +
    (chapter - 1) * QUESTIONS_PER_TEST * TESTS_PER_CHAPTER +
    (test - 1) * QUESTIONS_PER_TEST;
  const lastId = firstId + QUESTIONS_PER_TEST - 1;

  const rows = await cacheData(
    `practiceanswers:${subject}:${chapter}:${test}`,
    600,
    async () => {
      const { data, error } = await supabase
        .schema("study")
        .from("practicequestion10th")
        .select("answer")
        .gte("id", firstId)
        .lte("id", lastId)
        .order("id", { ascending: true });
      if (error) throw error;
      return data;
    },
    // only cache a complete test, so a short result is never stuck in Redis
    (d) => Array.isArray(d) && d.length === QUESTIONS_PER_TEST,
  );

  return rows.map((r) =>
    String(r.answer ?? "")
      .trim()
      .toLowerCase()
      .replace(/^option[\s_-]*/, ""),
  );
}

const isInt = (v) => Number.isInteger(v);

router.post("/submitpractice", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const b = req.body || {};

    // ---------- 1. validate input ----------
    const subject = String(b.subject ?? "")
      .trim()
      .toLowerCase();
    const chapter = parseInt(b.chapter, 10);
    const test = parseInt(b.test, 10);
    const layout = SUBJECT_LAYOUT[subject];

    if (
      !layout ||
      !isInt(chapter) ||
      chapter < 1 ||
      chapter > layout.chapters ||
      !isInt(test) ||
      test < 1 ||
      test > TESTS_PER_CHAPTER
    ) {
      return res.status(400).json({ success: false, message: "Invalid test" });
    }

    // free users can only do chapter 1
    if (!req.session.premium && chapter > 1) {
      return res
        .status(403)
        .json({ success: false, message: "Premium required" });
    }

    if (!Array.isArray(b.answers) || b.answers.length !== QUESTIONS_PER_TEST) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid answers" });
    }

    // each answer: null or "option_a".."option_d"
    const picked = [];
    for (const a of b.answers) {
      if (a === null || a === undefined) {
        picked.push(null);
        continue;
      }
      const m = /^option_([a-d])$/.exec(String(a));
      if (!m) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid answer value" });
      }
      picked.push(m[1]);
    }

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
    const timeSec = Math.floor(num(b.timetaken));
    const leaves = Math.floor(num(b.leaves));
    const awaySec = Math.floor(num(b.awaytime));

    if (
      !isInt(timeSec) ||
      timeSec < 0 ||
      !isInt(leaves) ||
      leaves < 0 ||
      leaves > 100 ||
      !isInt(awaySec) ||
      awaySec < 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid time data" });
    }

    const visibility = b.visibility === true; // only a real boolean true counts

    // ---------- 2. correct answers from the DB ----------
    const correct = await getCorrectAnswers(subject, chapter, test);
    if (correct.length !== QUESTIONS_PER_TEST) {
      console.error("submitpractice: wrong number of answers in DB", {
        subject,
        chapter,
        test,
        got: correct.length,
      });
      return res
        .status(404)
        .json({ success: false, message: "Test not found" });
    }

    // ---------- 3. compare attempted vs correct (server decides the score) ----------
    let attempted = 0;
    let right = 0;
    let wrong = 0;

    picked.forEach((p, i) => {
      if (p === null) return;
      attempted++;
      if (p === correct[i]) right++;
      else wrong++;
    });

    const total = QUESTIONS_PER_TEST;
    const unattempted = total - attempted;
    const percentage = Math.round((right / total) * 10000) / 100; // out of 100

    // ---------- 4. time in minutes ----------
    const safeSec = Math.min(timeSec, MAX_TEST_SECONDS);
    const timeMinutes = Math.round((safeSec / 60) * 100) / 100; // e.g. 12.35
    const awayMinutes =
      Math.round((Math.min(awaySec, MAX_TEST_SECONDS) / 60) * 100) / 100;

    // ---------- 5. clean record, ready for the DB ----------
    const record = {
      subject,
      chapter,
      test,
      score: percentage, // out of 100 (right * 2 for 50 questions)
      total,
      attempted,
      wrong,
      unattempted,
      percentage,
      time_taken: timeMinutes, // minutes
      away_time: awayMinutes, // minutes
      leaves,
      auto_submitted: visibility,
    };

    const test_info = `ch_${record.chapter}_test_${record.test}`;
    const ischeating = leaves >= MAX_LEAVES || visibility;

    // ---------- 6. save the score (only the first attempt of a test counts) ----------
    const { error } = await supabase.schema("study").from("scoretable").insert({
      username: req.session.username,
      useremail: req.session.useremail,
      test_info,
      test_score: record.score,
      test_timing: record.time_taken,
      cheating: ischeating,
      subject: record.subject,
      class: req.session.class,
    });

    if (error) {
      // unique (useremail, subject, test_info) -> first attempt already saved
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          alreadySubmitted: true,
          message: "You have already attempted this test.",
        });
      }
      console.error("scoretable insert error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Could not save result" });
    }

    // ---------- 7. leaderboard (practice count + average) ----------
    const { error: lbError } = await supabase
      .schema("study")
      .rpc("update_practice_leaderboard", {
        p_email: req.session.useremail,
        p_username: req.session.username,
        p_pct: record.percentage, // out of 100
      });

    if (lbError) {
      // the score is already saved, so don't fail the student
      console.error("leaderboard update error:", lbError);
    }

    // dashboard progress should show the new attempt right away
    try {
      await client.del(progressKey(req.session.useremail));
    } catch (e) {
      console.error("progress cache clear failed:", e);
    }

    return res.json({
      success: true,
      score: right,
      total,
      attempted,
      wrong,
      unattempted,
      percentage,
      timetaken: timeMinutes,
      visibility,
    });
  } catch (err) {
    console.error("submitpractice error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = {
  router,
};
