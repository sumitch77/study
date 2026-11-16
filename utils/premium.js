const { supabase } = require("./supabase");
const { cacheData } = require("./redisHelper");

// latest is_premium for this user (cached 60 s) and keep the session in sync
async function refreshPremium(req) {
  try {
    const premium = await cacheData(
      `premiumflag:${req.session.userId}`,
      60,
      async () => {
        const { data, error } = await supabase
          .schema("study")
          .from("userTable")
          .select("is_premium")
          .eq("user_id", req.session.userId)
          .maybeSingle();
        if (error) throw error;
        return data ? data.is_premium === true : false;
      },
      () => true,
    );
    req.session.premium = premium;
  } catch (err) {
    console.error("premium refresh failed:", err); // keep the value from login
  }
  return req.session.premium === true;
}

module.exports = { refreshPremium };
