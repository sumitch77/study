const { createClient } = require("redis");

const client = createClient({
  url: process.env.REDIS_URL,
});

client.on("error", (err) => {
  console.error("Redis Client Error:", err.message);
});

const inFlight = new Map();

async function cacheData(key, ttlSeconds, fetchData, shouldCache = () => true) {
  try {
    const cached = await client.get(key);
    if (cached !== null) return JSON.parse(cached);
  } catch (err) {
    console.error("Redis cache read error:", err.message);
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = Promise.resolve()
    .then(fetchData)
    .then(async (data) => {
      if (shouldCache(data)) {
        try {
          await client.set(key, JSON.stringify(data), { EX: ttlSeconds });
        } catch (err) {
          console.error("Redis cache write error:", err.message);
        }
      }
      return data;
    });

  inFlight.set(key, promise);

  const cleanup = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  promise.then(cleanup, cleanup);

  return promise;
}

async function clearUserDashboardCache(email) {
  const pattern = `dashboard:user:${email}:page:*`;

  for await (const keys of client.scanIterator({
    MATCH: pattern,
    COUNT: 100,
  })) {
    if (keys.length > 0) {
      await client.del(keys);
    }
  }
}

async function clearPublicDashboardCache() {
  const pattern = "dashboard:public:page:*";

  for await (const keys of client.scanIterator({
    MATCH: pattern,
    COUNT: 100,
  })) {
    if (keys.length > 0) {
      await client.del(keys);
    }
  }
}
module.exports = {
  client,
  cacheData,
  clearUserDashboardCache,
  clearPublicDashboardCache,
};
