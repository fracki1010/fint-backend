const request = require("supertest");

const { createApp } = require("../src/app");

async function run() {
  const app = createApp({ allowedOrigins: ["http://localhost:5173"] });
  const response = await request(app).get("/api/health");

  if (response.status !== 200) {
    throw new Error(`Health endpoint failed with status ${response.status}`);
  }

  if (!response.body || response.body.status !== "OK") {
    throw new Error("Unexpected health response payload");
  }

  console.log("Smoke check OK");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
