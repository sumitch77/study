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
const { canonicalEmail, length } = require("../utils/authlimiter");
const { forgotlimitter, forgotiplimiter } = require("../utils/forgotlimiter");

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

      const loginLink = `https://sumit7.website/linklogin?token=${selector}.${verifier}`;
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
