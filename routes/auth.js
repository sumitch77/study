const express = require("express");
const path = require("path");
const router2 = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { Resend } = require("resend");
const resendClient = new Resend(process.env.TOKEN);
const { check } = require("express-validator");
const { EmailLimiter, TimeLimiter, validate } = require("../utils/ratelimit");
const disposableDomains = require("disposable-email-domains");

const { supabase } = require("../utils/supabase");
const { login } = require("../utils/helper");
const {
  fingerprintLimiter,
  emailLimiter,
  generalLimiter,
  extremeLimiter,
  emailLimiter2,
  loginLimiter,
} = require("../utils/authlimiter");
const { client } = require("../utils/redisHelper");

const crypto = require("crypto");
const bcrypt = require("bcrypt");

router2.get("/logout", TimeLimiter, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "An error occurred during logout",
        error: err.message,
      });
    }
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

router2.get("/login", login, generalLimiter, extremeLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "../views/login.html"));
});
router2.get("/signup", login, generalLimiter, extremeLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "../views/signup.html"));
});

router2.post(
  "/login",
  login,
  fingerprintLimiter,
  loginLimiter,
  async (req, res) => {
    try {
      let { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
      }

      // emails are stored lowercase; do NOT trim the password (signup doesn't)
      email = String(email).trim().toLowerCase();
      password = String(password);

      const { data, error } = await supabase
        .schema("study")
        .from("userTable")
        .select("email,password,username,user_id,is_premium,class,role")
        .eq("email", email)
        .maybeSingle();

      if (error) {
        console.error("Supabase error:", error);
        return res.status(500).json({
          success: false,
          message: "Server error occurred during login",
        });
      }

      const isMatch = data
        ? await bcrypt.compare(password, data.password)
        : false;
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // the password is right, but the email was never verified
      if (data.role === "notverified") {
        return res.status(403).json({
          success: false,
          message:
            "Please verify your email first. Open the sign-in link we sent you (or sign up again to get a new one).",
        });
      }

      // new session id on login (prevents session fixation)
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );

      if (data.email === process.env.ADMINEMAIL) {
        req.session.admin = true;
      }
      req.session.userId = data.user_id;
      req.session.useremail = data.email;
      req.session.username = data.username;
      req.session.premium = data.is_premium;
      req.session.class = data.class || "10";

      return res.json({
        success: true,
        message: `Login successful`,
      });
    } catch (err) {
      console.error("Login error:", err);

      return res.status(500).json({
        success: false,
        message: "Server error occurred during login",
      });
    }
  },
);

// ---------- sign-in link email ----------
const LINK_MINUTES = 10;

async function sendLoginEmail(email, loginLink) {
  await resendClient.emails.send({
    from: "Highkey <Sumit@highkeyy.tech>",
    to: email,
    subject: "Your Highkey sign-in link",

    html: `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>Sign in to Highkey</title>
  </head>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <!-- preview text shown in the inbox list -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0a0a0a;">
      Your sign-in link is ready. It expires in 10 minutes.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
      <tr>
        <td align="center" style="padding:40px 16px;">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

            <!-- logo -->
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <span style="font-size:24px;font-weight:600;letter-spacing:-0.5px;color:#ffffff;">
                  &#9650; Highkey
                </span>
              </td>
            </tr>

            <!-- card -->
            <tr>
              <td style="background:#171717;border:1px solid #2a2a2a;border-radius:24px;padding:40px 32px;text-align:center;">

                <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;letter-spacing:-0.3px;color:#ffffff;">
                  Sign in to Highkey
                </h1>

                <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a3a3a3;">
                  Good to see you again. Tap the button below to sign in.
                  No password needed.
                </p>

                <!-- button -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="#ffffff" style="border-radius:12px;">
                      <a href="${loginLink}"
                         style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#000000;text-decoration:none;border-radius:12px;background:linear-gradient(180deg,#ffffff,#e2e8f0);">
                        Sign in &rarr;
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- expiry -->
                <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#737373;">
                  &#9201; This link expires in <strong style="color:#d4d4d4;">10 minutes</strong>
                  and can only be used once.
                </p>

                <!-- fallback link -->
                <div style="margin-top:28px;padding-top:24px;border-top:1px solid #2a2a2a;">
                  <p style="margin:0 0 8px;font-size:12px;color:#737373;">
                    Button not working? Copy and paste this link into your browser:
                  </p>
                  <a href="${loginLink}" style="font-size:12px;color:#a5b4fc;word-break:break-all;text-decoration:underline;">
                    ${loginLink}
                  </a>
                </div>

              </td>
            </tr>

            <!-- footer -->
            <tr>
              <td align="center" style="padding:24px 16px 0;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#737373;">
                  If you didn&rsquo;t request this email, you can safely ignore it.
                  Nobody can sign in without this link.
                </p>
                <p style="margin:0;font-size:12px;color:#525252;">
                  &copy; 2026 Highkey. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `,

    text: `Sign in to Highkey

Use the link below to sign in:
${loginLink}

This link expires in 10 minutes and can only be used once.

If you didn't request this email, you can safely ignore it.

© 2026 Highkey`,
  });
}

router2.post(
  "/signup",
  login,
  fingerprintLimiter,
  emailLimiter,
  emailLimiter2,
  [
    // no .normalizeEmail(): it strips dots from gmail addresses, so login by the
    // email the user typed would never match the stored one
    check("email")
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format"),
    check("password")
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 6, max: 20 })
      .withMessage("Password must be between 6 and 20 characters long"),
    check("username")
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ min: 2, max: 20 })
      .withMessage("Name must be between 2 and 20 characters long"),
  ],
  validate,
  async (req, res) => {
    try {
      let { email, username, password, confirmPassword } = req.body;

      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }

      email = String(email).trim().toLowerCase();
      const domain = email.split("@")[1]?.toLowerCase();
      if (disposableDomains.includes(domain)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Please use a real email address, not a temporary one.",
          });
      }

      // captcha first (cheap), bcrypt after (expensive)
      const captcha = req.session.captcha;
      const captchaIsValid =
        captcha &&
        captcha.valid === true &&
        String(captcha.email || "")
          .trim()
          .toLowerCase() === email &&
        typeof captcha.issuedAt === "number" &&
        Date.now() - captcha.issuedAt <= 3 * 60 * 1000;

      if (!captchaIsValid) {
        req.session.captcha = null;
        return res.status(400).json({
          success: false,
          message: "Captcha Verification failed , please try again",
        });
      }

      const { data: existing, error: existingErr } = await supabase
        .schema("study")
        .from("userTable")
        .select("email, role")
        .eq("email", email)
        .maybeSingle();

      if (existingErr) {
        console.error("Signup lookup error:", existingErr);
        return res.status(500).json({
          success: false,
          message: "Signup is currently not working",
        });
      }

      // a verified account already exists
      if (existing && existing.role !== "notverified") {
        return res.status(403).json({
          success: false,
          message: "This account already exist , Please Login",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      if (!existing) {
        const { error: userError } = await supabase
          .schema("study")
          .from("userTable")
          .insert({
            email,
            username,
            password: passwordHash,
            role: "notverified",
            class: "10",
          });
        if (userError) {
          console.error("Supabase user insert error:", userError);
          return res.status(500).json({
            success: false,
            message: "Signup is currently not working",
          });
        }
      } else {
        // signed up before but never verified: refresh the details and send a new link
        const { error: updErr } = await supabase
          .schema("study")
          .from("userTable")
          .update({ username, password: passwordHash })
          .eq("email", email);
        if (updErr) {
          console.error("Supabase user update error:", updErr);
          return res.status(500).json({
            success: false,
            message: "Signup is currently not working",
          });
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const { error } = await supabase
        .schema("study")
        .from("email_verify")
        .insert({
          token: tokenHash,
          email,
          // set explicitly, so a database default / timezone can't expire it early
          expires_at: new Date(
            Date.now() + LINK_MINUTES * 60 * 1000,
          ).toISOString(),
        });

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({
          success: false,
          message: "Signup is currently not working",
        });
      }

      try {
        const loginLink = `https://highkeyy.tech/linklogin?token=${token}`;
        await sendLoginEmail(email, loginLink);
        console.log(` login link sent to ${email}`);
      } catch (mailErr) {
        console.log("Email error:", mailErr);
        return res.status(500).json({
          success: false,
          message: "Failed to send email",
        });
      }

      req.session.captcha = null; // one captcha = one signup
      return res.json({
        success: true,
        message: `Login link sent to ${email}`,
      });
    } catch (err) {
      console.error("Signup error:", err);
      return res.status(500).json({
        success: false,
        message: "Signup is currently not working",
      });
    }
  },
);

// ---------- small status pages for the sign-in link ----------
function linkPage(title, text, { ok = false, extra = "" } = {}) {
  const color = ok ? "#34d399" : "#f87171";
  const icon = ok ? "&#10003;" : "&#10005;";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#0B1220;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
    .card{width:100%;max-width:420px;background:#172337;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:32px;text-align:center}
    .ic{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;color:${color};background:${color}22}
    h1{margin:0;font-size:20px}
    p{margin:8px 0 0;font-size:14px;color:#94a3b8;line-height:1.5}
    button,a.btn{display:inline-block;margin-top:22px;padding:12px 28px;border:0;border-radius:12px;background:#2878F0;color:#fff;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <div class="ic">${icon}</div>
    <h1>${title}</h1>
    <p>${text}</p>
    ${extra}
  </div>
</body>
</html>`;
}

const TOKEN_RE = /^[a-f0-9]{64}$/;

// Step 1 (GET): only CHECKS the link and shows a button. It never uses the link up.
// Email scanners / link previews open GET links automatically; if GET signed the
// user in, the scanner would burn the link and the real click would say "expired".
router2.get("/linklogin", generalLimiter, login, async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!TOKEN_RE.test(token)) {
      return res
        .status(400)
        .send(
          linkPage(
            "Invalid login link",
            "This login link is invalid or incomplete.",
          ),
        );
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { data, error } = await supabase
      .schema("study")
      .from("email_verify")
      .select("email")
      .eq("token", tokenHash)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error("Token lookup error:", error);
      return res
        .status(500)
        .send(linkPage("Something went wrong", "Please try again later."));
    }

    if (!data) {
      return res
        .status(401)
        .send(
          linkPage(
            "Login link expired",
            "This login link is invalid, expired, or has already been used.",
            { extra: `<a class="btn" href="/login">Go to login</a>` },
          ),
        );
    }

    return res.send(
      linkPage(
        "Confirm sign in",
        "Tap the button to finish signing in to Highkey.",
        {
          ok: true,
          extra: `<form method="POST" action="/linklogin"><input type="hidden" name="token" value="${token}"><button type="submit">Sign in</button></form>`,
        },
      ),
    );
  } catch (error) {
    console.error("email login error:", error);
    res.status(500).send(linkPage("Login failed", "Please try again."));
  }
});

// Step 2 (POST): uses the link up (atomically), verifies the user, signs in, redirects.
router2.post(
  "/linklogin",
  generalLimiter,
  login,
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const token = String((req.body && req.body.token) || "");
      if (!TOKEN_RE.test(token)) {
        return res
          .status(400)
          .send(
            linkPage(
              "Invalid login link",
              "This login link is invalid or incomplete.",
            ),
          );
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      // claim the link in ONE query: only one request can ever flip used false -> true
      const { data: claimed, error: claimError } = await supabase
        .schema("study")
        .from("email_verify")
        .update({ used: true })
        .eq("token", tokenHash)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .select("email")
        .maybeSingle();

      if (claimError) {
        console.error("Token claim error:", claimError);
        return res
          .status(500)
          .send(linkPage("Something went wrong", "Please try again later."));
      }

      if (!claimed) {
        return res
          .status(401)
          .send(
            linkPage(
              "Login link expired",
              "This login link is invalid, expired, or has already been used.",
              { extra: `<a class="btn" href="/login">Go to login</a>` },
            ),
          );
      }

      const { data: user, error: userError } = await supabase
        .schema("study")
        .from("userTable")
        .update({ role: "user" })
        .eq("email", claimed.email)
        .select("user_id, email, username, is_premium, class")
        .maybeSingle();

      if (userError || !user) {
        console.error("User update error:", userError || "user not found");
        // give the link back so the user can try again
        await supabase
          .schema("study")
          .from("email_verify")
          .update({ used: false })
          .eq("token", tokenHash);
        return res
          .status(500)
          .send(linkPage("Something went wrong", "Please try again later."));
      }

      // leaderboard row (ignore "already exists")
      const { error: lbError } = await supabase
        .schema("study")
        .from("leaderboard")
        .insert({
          username: user.username,
          useremail: user.email,
          totalpractice: 0,
          totaltest: 0,
          avgscorepractice: 0,
          avgscoretest: 0,
        });
      if (lbError && lbError.code !== "23505") {
        console.error("Leaderboard insert error:", lbError);
      }

      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.userId = user.user_id;
      req.session.useremail = user.email;
      req.session.username = user.username;
      req.session.premium = user.is_premium;
      req.session.class = user.class || "10";

      // saved first, then redirect (no inline script needed)
      return req.session.save((e) => {
        if (e) {
          console.error("Session save error:", e);
          return res
            .status(500)
            .send(linkPage("Login failed", "Please try again."));
        }
        return res.redirect("/");
      });
    } catch (error) {
      console.error("email login error:", error);
      res.status(500).send(linkPage("Login failed", "Please try again."));
    }
  },
);

module.exports = {
  router2,
};
