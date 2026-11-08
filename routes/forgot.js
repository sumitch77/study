const express = require("express");
const path = require("path");
const router8 = express.Router();
const dotenv = require("dotenv");
dotenv.config();
const { Resend } = require("resend");
const resendClient = new Resend(process.env.TOKEN);
const { check } = require("express-validator");
const { EmailLimiter, TimeLimiter, validate } = require("../utils/ratelimit");
const { upload, cloudinary } = require("../utils/ratelimit");
const validate2 = require("deep-email-validator");
const { type } = require("os");
const { supabase } = require("../utils/supabase");
const { login } = require("../utils/helper");
const {
  canonicalEmail,
  forgotlimitter,
  length,
  forgotiplimiter,
} = require("../utils/authlimiter");

const crypto = require("crypto");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;
const RESET_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const FORGOT_MESSAGE = "If that email exists, a reset link has been sent.";

// Link token = "<selector>.<verifier>"
//  - selector: 16 random bytes (32 hex), stored as plain text, only used to find the row
//  - verifier: 32 random bytes (64 hex), stored ONLY as a bcrypt hash
// (bcrypt is salted, so a hash can't be searched with .eq(); the selector does the lookup)
const TOKEN_RE = /^[a-f0-9]{32}\.[a-f0-9]{64}$/;

// finds an active, unexpired reset row for this token and checks the verifier with bcrypt
async function findValidReset(token) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    return { data: null, error: null };
  }

  const [selector, verifier] = token.split(".");

  const { data, error } = await supabase
    .schema("study")
    .from("reset_pass")
    .select("id, email, token_hash")
    .eq("selector", selector)
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  const match = await bcrypt.compare(verifier, data.token_hash);
  return { data: match ? data : null, error: null };
}

router8.get("/forgot", (req, res) => {
  res.sendFile(path.join(__dirname, "../views/forgotlink.html"));
});

router8.post(
  "/forgot",
  login,
  forgotiplimiter,
  length,
  forgotlimitter,
  async (req, res) => {
    let { email } = req.body;
    email = String(email || "").trim();
    email = canonicalEmail(email);
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }
    const { data, error } = await supabase
      .schema("study")
      .from("userTable")
      .select("email, username")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("Database error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Database error" });
    }
    if (!data) {
      return res.json({ success: true, message: FORGOT_MESSAGE });
    }

    // From here on every outcome returns the same message, so nobody can tell
    // whether the email exists. Real failures are only logged.
    try {
      const selector = crypto.randomBytes(16).toString("hex");
      const verifier = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(verifier, SALT_ROUNDS);

      // invalidate all older links for this email
      const { error: invalidateError } = await supabase
        .schema("study")
        .from("reset_pass")
        .update({ active: false })
        .eq("email", email)
        .eq("active", true);

      if (invalidateError) {
        console.error("Could not invalidate old reset links:", invalidateError);
        return res.json({ success: true, message: FORGOT_MESSAGE });
      }

      const { error: tokenError } = await supabase
        .schema("study")
        .from("reset_pass")
        .insert({
          email,
          selector,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + RESET_EXPIRY_MS).toISOString(),
        });

      if (tokenError) {
        console.error("Could not save reset token:", tokenError);
        return res.json({ success: true, message: FORGOT_MESSAGE });
      }

      const loginLink = `https://sumit7.website/resetpassword?token=${selector}.${verifier}`;

      const { error: sendError } = await resendClient.emails.send({
        from: "Sumit <Sumit@sumit7.website>",
        to: email,
        subject: "Reset Your Password",

        html: `
      <!DOCTYPE html>
      <html>
        <body style="
          margin: 0;
          padding: 0;
          background: #f5f7fb;
          font-family: Arial, Helvetica, sans-serif;
          color: #171717;
        ">
          <div style="
            max-width: 520px;
            margin: 40px auto;
            padding: 0 20px;
          ">

            <div style="
              background: #ffffff;
              border-radius: 16px;
              padding: 40px 35px;
              text-align: center;
              border: 1px solid #e5e7eb;
            ">

              <div style="
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 28px;
              ">
                Cloud
              </div>

              <h1 style="
                margin: 0 0 12px;
                font-size: 24px;
                color: #111827;
              ">
                Reset Your Password
              </h1>

              <p style="
                margin: 0 0 28px;
                color: #6b7280;
                font-size: 15px;
                line-height: 1.6;
              ">
                Click the button below to securely reset your password.
              </p>

              <a href="${loginLink}" style="
                display: inline-block;
                background: #7c3aed;
                color: #ffffff;
                text-decoration: none;
                font-size: 16px;
                font-weight: 600;
                padding: 14px 30px;
                border-radius: 10px;
              ">
                Reset Your Password
              </a>

              <p style="
                margin: 28px 0 0;
                color: #9ca3af;
                font-size: 13px;
                line-height: 1.5;
              ">
                This reset link will expire in 15 minutes and can only be
                used once.
              </p>

              <div style="
                margin-top: 25px;
                padding-top: 20px;
                border-top: 1px solid #eeeeee;
                color: #9ca3af;
                font-size: 12px;
              ">
                If you didn't request this email, you can safely ignore it.
              </div>

            </div>

            <p style="
              text-align: center;
              color: #9ca3af;
              font-size: 12px;
              margin-top: 20px;
            ">
              © 2026 Cloud
            </p>

          </div>
        </body>
      </html>
    `,

        text: `
Reset Your Password

Click the link below to reset your password:
${loginLink}

This link expires in 15 minutes and can only be used once.

If you didn't request this email, you can safely ignore it.
    `,
      });

      if (sendError) {
        console.error("Error sending reset email:", sendError);
      }
    } catch (error) {
      console.error("Forgot password error:", error);
    }

    return res.json({ success: true, message: FORGOT_MESSAGE });
  },
);

router8.get("/resetpassword", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Link</title>
      <link rel="stylesheet" href="/output.css">
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

          <h1 class="text-xl font-semibold">Invalid reset link</h1>
          <p class="mt-2 text-sm text-neutral-400">
            This password reset link is missing or invalid.
          </p>
        </div>
      </body>
      </html>
    `);
  }

  const { data, error } = await findValidReset(token);

  if (error) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
      <link rel="stylesheet" href="/output.css">
      </head>

      <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
        <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <h1 class="text-xl font-semibold text-red-400">
            Something went wrong
          </h1>

          <p class="mt-2 text-sm text-neutral-400">
            We couldn't verify your reset link. Please try again later.
          </p>
        </div>
      </body>
      </html>
    `);
  }

  if (!data) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Link Expired</title>
      <link rel="stylesheet" href="/output.css">
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

          <h1 class="text-xl font-semibold">
            Link expired
          </h1>

          <p class="mt-2 text-sm text-neutral-400">
            This password reset link is invalid or has expired.
          </p>

        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">

      <title>Verifying reset link</title>

      <link rel="stylesheet" href="/output.css">
    </head>

    <body class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">

      <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">

        <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">

          <div class="h-8 w-8 animate-spin rounded-full border-4 border-neutral-700 border-t-blue-500"></div>

        </div>

        <h1 class="text-xl font-semibold">
          Verifying your reset link
        </h1>

        <p class="mt-2 text-sm text-neutral-400">
          Please wait while we verify your request.
        </p>

      </div>

      <script>
        setTimeout(() => {
          window.location.href =
            '/resetconfirmpassword?token=${encodeURIComponent(token)}';
        }, 1200);
      </script>

    </body>
    </html>
  `);
});

router8.get("/resetconfirmpassword", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Link</title>
      <link rel="stylesheet" href="/output.css">
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

          <h1 class="text-xl font-semibold">Invalid reset link</h1>
          <p class="mt-2 text-sm text-neutral-400">
            This password reset link is missing or invalid.
          </p>
        </div>
      </body>
      </html>
    `);
  }

  const { data: resetData, error: resetError } = await findValidReset(token);

  if (resetError) {
    console.error("Reset token lookup error:", resetError);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }

  if (!resetData) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Link Expired</title>
      <link rel="stylesheet" href="/output.css">
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

          <h1 class="text-xl font-semibold">
            Link expired
          </h1>

          <p class="mt-2 text-sm text-neutral-400">
            This password reset link is invalid or has expired.
          </p>

        </div>
      </body>
      </html>
      `);
  }
  res.sendFile(path.join(__dirname, "../views/forgot.html"));
});

router8.post("/resetpassword", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Please fill all fields",
      });
    }
    if (
      typeof token !== "string" ||
      !TOKEN_RE.test(token) ||
      typeof password !== "string"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request" });
    }

    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Password should be between 6 and 100 characters",
      });
    }

    // 1. verify the token (selector lookup + bcrypt compare of the verifier)
    const { data: resetData, error: resetError } = await findValidReset(token);

    if (resetError) {
      console.error("Reset token lookup error:", resetError);

      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }

    if (!resetData) {
      return res.status(400).json({
        success: false,
        message: "Reset link is invalid or expired",
      });
    }

    // 2. hash the new password before touching the token
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 3. atomically claim the token: only one request can flip active true -> false
    const { data: claimed, error: claimError } = await supabase
      .schema("study")
      .from("reset_pass")
      .update({ active: false, used_at: new Date().toISOString() })
      .eq("id", resetData.id)
      .eq("active", true)
      .gt("expires_at", new Date().toISOString())
      .select("email")
      .maybeSingle();

    if (claimError) {
      console.error("Token claim error:", claimError);

      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }

    if (!claimed) {
      // someone else already used it (or it just expired)
      return res.status(400).json({
        success: false,
        message: "Reset link is invalid or expired",
      });
    }

    // 4. update the user's password
    const { data: updatedUsers, error: userError } = await supabase
      .schema("study")
      .from("userTable")
      .update({
        password: hashedPassword,
      })
      .eq("email", claimed.email)
      .select("email");

    if (userError || !updatedUsers || updatedUsers.length === 0) {
      console.error("Password update error:", userError);

      // give the link back so the user can try again
      const { error: restoreError } = await supabase
        .schema("study")
        .from("reset_pass")
        .update({ active: true, used_at: null })
        .eq("id", resetData.id);

      if (restoreError) {
        console.error("Could not restore reset token:", restoreError);
      }

      return res.status(500).json({
        success: false,
        message: "Failed to update password",
      });
    }

    // 5. invalidate every other active link for this email
    const { error: cleanupError } = await supabase
      .schema("study")
      .from("reset_pass")
      .update({ active: false })
      .eq("email", claimed.email)
      .eq("active", true);

    if (cleanupError) {
      console.error("Could not invalidate other reset links:", cleanupError);
    }

    return res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Password reset error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
});

module.exports = { router8 };
