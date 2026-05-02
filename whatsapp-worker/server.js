require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const handler = require("./handler");

const app = express();
app.use(express.json({ limit: "25mb" }));

const WORKER_PORT = process.env.WORKER_PORT || 3001;
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET || "";

const requireSecret = (req, res, next) => {
  if (!WORKER_INTERNAL_SECRET) return next();
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${WORKER_INTERNAL_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
};

app.get("/health", (_req, res) => {
  res.json({ status: "OK", service: "whatsapp-worker" });
});

app.get("/status", requireSecret, (_req, res) => {
  res.json(handler.getStatus());
});

app.post("/start", requireSecret, async (_req, res) => {
  try {
    const result = await handler.start();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/stop", requireSecret, async (_req, res) => {
  try {
    const result = await handler.stop();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restart", requireSecret, async (_req, res) => {
  try {
    const result = await handler.restart();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/send", requireSecret, async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ error: "Faltan campos: to, body" });
  }
  try {
    await handler.sendText(to, body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/send-media", requireSecret, async (req, res) => {
  const { to, mediaBase64, mimetype, filename, caption } = req.body;
  if (!to || !mediaBase64 || !mimetype) {
    return res
      .status(400)
      .json({ error: "Faltan campos: to, mediaBase64, mimetype" });
  }
  try {
    await handler.sendMedia(to, mediaBase64, mimetype, filename, caption);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(WORKER_PORT, () => {
  console.log(`🟢 WhatsApp Worker escuchando en puerto ${WORKER_PORT}`);
});
