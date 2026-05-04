const nodemailer = require("nodemailer");
const { logError } = require("../utils/logger");

const isProduction = () => process.env.NODE_ENV === "production";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

function buildWelcomeEmail({ businessName, adminName, email, tempPassword, plan, trialEndsAt }) {
  const planLabel = { essential: "Essential", business: "Business", enterprise: "Enterprise" }[plan] || plan;
  const trialDate = trialEndsAt ? new Date(trialEndsAt).toLocaleDateString("es-AR") : "";

  const subject = `Bienvenido a Fint Suite — Tu cuenta está lista`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bienvenido a Fint Suite</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo h1 { color: #3b82f6; font-size: 28px; margin: 0; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid rgba(255,255,255,0.08); }
    .title { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #f8fafc; }
    .subtitle { font-size: 14px; color: #94a3b8; margin: 0 0 24px; }
    .field { margin-bottom: 16px; }
    .field-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 0 0 4px; }
    .field-value { font-size: 15px; color: #f1f5f9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0f172a; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); }
    .plan-badge { display: inline-block; background: rgba(59,130,246,0.12); color: #60a5fa; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .btn { display: inline-block; background: #3b82f6; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 700; margin-top: 8px; }
    .footer { text-align: center; margin-top: 32px; font-size: 12px; color: #64748b; }
    .trial { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.18); color: #fbbf24; padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>Fint Suite</h1>
    </div>
    <div class="card">
      <p class="title">¡Hola, ${adminName}!</p>
      <p class="subtitle">Tu cuenta para <strong>${businessName}</strong> ha sido creada exitosamente.</p>

      <div style="margin-bottom: 20px;">
        <span class="plan-badge">Plan ${planLabel}</span>
      </div>

      <div class="field">
        <p class="field-label">Email de acceso</p>
        <p class="field-value">${email}</p>
      </div>

      ${tempPassword ? `
      <div class="field">
        <p class="field-label">Contraseña temporal</p>
        <p class="field-value">${tempPassword}</p>
      </div>
      ` : ""}

      ${trialDate ? `
      <div class="trial">
        Tu período de prueba es de 14 días y finaliza el <strong>${trialDate}</strong>.
      </div>
      ` : ""}

      <p style="font-size: 13px; color: #94a3b8; margin-top: 20px;">
        Te recomendamos cambiar tu contraseña al iniciar sesión por primera vez.
      </p>
    </div>
    <div class="footer">
      <p>Si tenés alguna duda, respondé a este email o contactanos por WhatsApp.</p>
      <p style="margin-top: 8px;">© Fint Suite</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Bienvenido a Fint Suite

Hola ${adminName},
Tu cuenta para ${businessName} ha sido creada exitosamente.

Plan: ${planLabel}
Email: ${email}
${tempPassword ? `Contraseña temporal: ${tempPassword}` : ""}
${trialDate ? `Período de prueba hasta: ${trialDate}` : ""}

Te recomendamos cambiar tu contraseña al iniciar sesión.

© Fint Suite
  `.trim();

  return { subject, html, text };
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log("[EMAIL] No SMTP configured. Email would be sent to:", to);
    console.log("[EMAIL] Subject:", subject);
    console.log("[EMAIL] Text preview:", text?.slice(0, 200));
    return { success: true, message: "Email logged to console (no SMTP configured)" };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "noreply@fintsuite.com",
      to,
      subject,
      text,
      html,
    });

    console.log("[EMAIL] Sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logError("email_send_failed", { to, subject, error: error.message });
    console.error("[EMAIL] Failed to send:", error.message);
    throw error;
  }
}

async function verifyEmailConnection() {
  const transporter = getTransporter();
  if (!transporter) {
    console.log("[EMAIL] SMTP not configured — emails will be logged to console only");
    return false;
  }

  try {
    await transporter.verify();
    console.log("[EMAIL] SMTP connection verified successfully");
    return true;
  } catch (error) {
    console.error("[EMAIL] SMTP connection failed:", error.message);
    return false;
  }
}

module.exports = {
  sendEmail,
  buildWelcomeEmail,
  verifyEmailConnection,
};
