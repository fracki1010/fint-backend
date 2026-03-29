const subscribersByUser = new Map();

const getUserBucket = (userId) => {
  const key = userId.toString();
  if (!subscribersByUser.has(key)) {
    subscribersByUser.set(key, new Set());
  }
  return subscribersByUser.get(key);
};

const subscribe = (userId, res) => {
  const bucket = getUserBucket(userId);
  bucket.add(res);
};

const unsubscribe = (userId, res) => {
  const key = userId.toString();
  const bucket = subscribersByUser.get(key);
  if (!bucket) return;

  bucket.delete(res);
  if (bucket.size === 0) {
    subscribersByUser.delete(key);
  }
};

const publishToUser = (userId, payload) => {
  const key = userId.toString();
  const bucket = subscribersByUser.get(key);
  if (!bucket || bucket.size === 0) return;

  const eventPayload = `data: ${JSON.stringify(payload)}\n\n`;
  bucket.forEach((res) => {
    try {
      res.write(eventPayload);
    } catch {
      bucket.delete(res);
    }
  });
};

module.exports = {
  subscribe,
  unsubscribe,
  publishToUser,
};
