const express = require("express");
const path = require("path");
const router2 = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { Resend } = require("resend");
const resendClient = new Resend(process.env.TOKEN);
const { check } = require("express-validator");
const { EmailLimiter, TimeLimiter, validate } = require("../utils/ratelimit");

const { type } = require("os");
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

      email = String(email || "").trim();
      password = String(password || "").trim();

      const { data, error } = await supabase
        .schema("study")
        .from("userTable")
        .select("email,password , username , user_id")
        .eq("email", email)
        .maybeSingle();

      if (data) {
        const isMatch = await bcrypt.compare(password, data.password);

        if (isMatch) {
          if (data.email === process.env.ADMINEMAIL) {
            req.session.admin = true;
          }
          req.session.userId = data.user_id;
          req.session.useremail = data.email;
          req.session.username = data.username;
          return res.json({
            success: true,
            message: `Login successful`,
          });
        }
        return res.json({
          success: false,
          message: `Invalid email or password`,
        });
      }

      if (!data) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }
      if (error) {
        console.error("Supabase error:", error);
        return res.json({
          success: false,
          message: `Invalid email or password`,
        });
      }
    } catch (err) {
      console.error("Login error:", err);

      return res.status(500).json({
        success: false,
        message: "Server error occurred during login",
      });
    }
  },
);
router2.post(
  "/signup",
  login,
  fingerprintLimiter,
  emailLimiter,
  emailLimiter2,
  [
    check("email")
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
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
  async (req, res, next) => {
    let { email, username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }
    password = await bcrypt.hash(password, 10);

    const captcha = req.session.captcha;
    const captchaIsValid =
      captcha &&
      captcha.valid === true &&
      captcha.email === email &&
      typeof captcha.issuedAt === "number" &&
      Date.now() - captcha.issuedAt <= 3 * 60 * 1000;

    if (!captchaIsValid) {
      req.session.captcha = null;
      return res.status(400).json({
        success: false,
        message: "Captcha Verification failed , please try again",
      });
    }
    email = email.toLowerCase().trim();
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { data, error } = await supabase
      .schema("study")
      .from("email_verify")
      .insert({
        token: tokenHash,
        email: email,
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({
        success: false,
        message: "Signup is currently not working",
        error: error.message,
      });
    }

    try {
      const loginLink = `https://sumit7.website/linklogin?token=${token}`;

      await resendClient.emails.send({
        from: "Highkey <Sumit@sumit7.website>",
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

      console.log(` login link sent to ${email}`);

      const { data: user, error: userError } = await supabase
        .schema("study")
        .from("userTable")
        .insert({
          email: email,
          username: username,
          password: password,
          role: "notverified",
        });
      if (userError) {
        console.error("Supabase user insert error:", userError);
        return res.status(500).json({
          success: false,
          message: "Signup is currently not working",
          error: userError.message,
        });
      }
      return res.json({
        success: true,
        message: `Login link sent to ${email}`,
      });
    } catch (error) {
      console.log("Email error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to send email",
        error: error.message,
      });
    }
  },
);

router2.get("/linklogin", generalLimiter, login, async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="/css/output.css">
            <title>Invalid Login Link</title>
        </head>
        <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
            <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
                <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                    <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M6 18 18 6M6 6l12 12" />
                    </svg>
                </div>

                <h1 class="text-xl font-semibold">Invalid login link</h1>

                <p class="mt-2 text-sm text-neutral-400">
                    This login link is invalid or incomplete.
                </p>
            </div>
        </body>
        </html>
    `);
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { data, error } = await supabase
      .schema("study")
      .from("email_verify")
      .select("email, expires_at")
      .eq("token", tokenHash)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error("Token lookup error:", error);
      return res
        .status(500)
        .send("Something went wrong with server. Try again later.");
    }

    if (!data) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="/css/output.css">
            <title>Login Link Expired</title>
        </head>
        <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
            <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
                <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                    <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M6 18 18 6M6 6l12 12" />
                    </svg>
                </div>

                <h1 class="text-xl font-semibold">Login link expired</h1>

                <p class="mt-2 text-sm text-neutral-400">
                    This login link is invalid, expired, or has already been used.
                </p>
            </div>
        </body>
        </html>
    `);
    }

    const { data: user, error: userError } = await supabase
      .schema("study")
      .from("userTable")
      .update({ role: "user" })
      .eq("email", data.email)
      .select("user_id, email, username")
      .maybeSingle();

    const { error: updateError } = await supabase
      .schema("study")
      .from("email_verify")
      .update({ used: true })
      .eq("token", tokenHash);

    if (userError || updateError) {
      console.error("User update error:", userError || updateError);
      return res.status(500).send("Failed to contact with database.");
    }

    req.session.userId = user.user_id;
    req.session.useremail = user.email;
    req.session.username = user.username;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login successful</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>

      <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">

        <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">

          <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">
            <div class="h-8 w-8 animate-spin rounded-full border-4 border-neutral-700 border-t-blue-500"></div>
          </div>

          <h1 class="text-xl font-semibold">
            Login successful
          </h1>

          <p class="mt-2 text-sm text-neutral-400">
            Taking you to your dashboard...
          </p>

        </div>

        <script>
          setTimeout(() => {
            window.location.href = '/';
          }, 1200);
        </script>

      </body>
      </html>
    `);
  } catch (error) {
    console.error("email login error:", error);
    res.status(500).send("Login failed.");
  }
});

module.exports = {
  router2,
};
