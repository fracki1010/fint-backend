const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { sendError, sendSuccess } = require("../utils/http");
const Tenant = require("../models/tenant.model");
const PaymentRecord = require("../models/payment.model");
const { logInfo, logError } = require("../utils/logger");

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || "",
});

const PLAN_PRICES = {
  essential: 2000,   // $20.00 ARS (en centavos: 2000)
  business: 3000,    // $30.00 ARS
  enterprise: 8000,  // $80.00 ARS
};

const PLAN_NAMES = {
  essential: "Fint Essential",
  business: "Fint Business",
  enterprise: "Fint Enterprise",
};

/**
 * POST /api/payments/create-preference
 * Crea una preferencia de pago en MercadoPago para el plan seleccionado.
 */
async function createPreference(req, res) {
  try {
    const { plan } = req.body;
    const tenantId = req.user?.tenant;
    const userEmail = req.user?.email;

    if (!tenantId) {
      return sendError(res, { status: 401, code: "UNAUTHORIZED", message: "Tenant no identificado." });
    }

    if (!plan || !PLAN_PRICES[plan]) {
      return sendError(res, { status: 400, code: "INVALID_PLAN", message: "Plan no válido." });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return sendError(res, { status: 404, code: "TENANT_NOT_FOUND", message: "Tenant no encontrado." });
    }

    const price = PLAN_PRICES[plan];
    const title = PLAN_NAMES[plan];

    const preference = new Preference(client);
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const response = await preference.create({
      body: {
        items: [
          {
            id: `plan-${plan}`,
            title,
            description: `Suscripción mensual - ${title}`,
            quantity: 1,
            unit_price: price,
            currency_id: "ARS",
          },
        ],
        payer: {
          email: userEmail || tenant.billing?.email || "cliente@example.com",
        },
        external_reference: JSON.stringify({ tenantId: tenantId.toString(), plan }),
        back_urls: {
          success: `${baseUrl}/admin/company?payment=success`,
          pending: `${baseUrl}/admin/company?payment=pending`,
          failure: `${baseUrl}/admin/company?payment=failure`,
        },
        notification_url: process.env.MERCADO_PAGO_WEBHOOK_URL
          ? `${process.env.MERCADO_PAGO_WEBHOOK_URL}/api/payments/webhook`
          : undefined,
      },
    });

    return sendSuccess(res, {
      data: {
        preferenceId: response.id,
        initPoint: response.init_point,
        sandboxInitPoint: response.sandbox_init_point,
      },
    });
  } catch (error) {
    console.error("[MercadoPago] Error creating preference:", error);
    return sendError(res, {
      status: 500,
      code: "PAYMENT_ERROR",
      message: "Error al crear la preferencia de pago.",
    });
  }
}

/**
 * Procesa un pago aprobado de MercadoPago.
 */
async function processApprovedPayment(paymentData) {
  try {
    const externalRef = paymentData.external_reference;
    if (!externalRef) {
      logInfo("mp_webhook_no_reference", { paymentId: paymentData.id });
      return;
    }

    let refData;
    try {
      refData = JSON.parse(externalRef);
    } catch {
      logInfo("mp_webhook_invalid_reference", { paymentId: paymentData.id, externalRef });
      return;
    }

    const { tenantId, plan } = refData;
    if (!tenantId || !plan) {
      logInfo("mp_webhook_missing_data", { paymentId: paymentData.id, refData });
      return;
    }

    // Buscar tenant
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      logInfo("mp_webhook_tenant_not_found", { paymentId: paymentData.id, tenantId });
      return;
    }

    // Verificar si ya procesamos este pago
    const existing = await PaymentRecord.findOne({ mercadoPagoPaymentId: String(paymentData.id) });
    if (existing && existing.status === "approved") {
      logInfo("mp_webhook_already_processed", { paymentId: paymentData.id });
      return;
    }

    // Guardar/actualizar registro de pago
    const paymentRecord = existing || new PaymentRecord({
      tenant: tenantId,
      plan,
      mercadoPagoPaymentId: String(paymentData.id),
      mercadoPagoPreferenceId: paymentData.preference_id,
      amount: paymentData.transaction_amount,
      currency: paymentData.currency_id || "ARS",
      status: "approved",
      paymentMethod: paymentData.payment_method_id,
      payerEmail: paymentData.payer?.email,
      paidAt: new Date(),
      metadata: {
        installments: paymentData.installments,
        paymentTypeId: paymentData.payment_type_id,
        issuerId: paymentData.issuer_id,
      },
    });

    if (existing) {
      paymentRecord.status = "approved";
      paymentRecord.paidAt = new Date();
    }

    await paymentRecord.save();

    // Actualizar tenant: cambiar plan y extender suscripción
    const now = new Date();
    const oneMonthLater = new Date(now);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

    tenant.plan = plan;
    tenant.status = "active";
    tenant.billing = {
      ...tenant.billing,
      paymentStatus: "paid",
      subscriptionStartedAt: now,
      subscriptionEndsAt: oneMonthLater,
    };

    await tenant.save();

    logInfo("mp_webhook_payment_processed", {
      paymentId: paymentData.id,
      tenantId,
      plan,
      amount: paymentData.transaction_amount,
    });
  } catch (error) {
    logError("mp_webhook_process_error", {
      paymentId: paymentData?.id,
      message: error?.message,
    });
  }
}

/**
 * POST /api/payments/webhook
 * Recibe notificaciones IPN de MercadoPago.
 */
async function webhook(req, res) {
  try {
    // MercadoPago espera respuesta 200 inmediatamente
    res.status(200).send("OK");

    const { type, data } = req.body;

    if (type === "payment" && data?.id) {
      const paymentId = String(data.id);
      logInfo("mp_webhook_received", { paymentId, type });

      // Consultar el payment vía API para verificar estado
      const payment = new Payment(client);
      const paymentData = await payment.get({ id: paymentId });

      logInfo("mp_webhook_payment_detail", {
        paymentId,
        status: paymentData.status,
        externalRef: paymentData.external_reference,
      });

      if (paymentData.status === "approved") {
        await processApprovedPayment(paymentData);
      } else if (["rejected", "cancelled"].includes(paymentData.status)) {
        // Actualizar registro a rechazado si existe
        const existing = await PaymentRecord.findOne({ mercadoPagoPaymentId: paymentId });
        if (existing) {
          existing.status = paymentData.status;
          await existing.save();
        }
      }
    }
  } catch (error) {
    logError("mp_webhook_error", {
      message: error?.message,
      stack: error?.stack,
    });
  }
}

/**
 * GET /api/payments/history
 * Devuelve el historial de pagos del tenant.
 */
async function getPaymentHistory(req, res) {
  try {
    const tenantId = req.user?.tenant;
    if (!tenantId) {
      return sendError(res, { status: 401, code: "UNAUTHORIZED", message: "Tenant no identificado." });
    }

    const payments = await PaymentRecord.find({ tenant: tenantId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return sendSuccess(res, { data: payments });
  } catch (error) {
    logError("mp_payment_history_error", { message: error?.message });
    return sendError(res, { status: 500, code: "PAYMENT_ERROR", message: "Error al obtener historial de pagos." });
  }
}

module.exports = {
  createPreference,
  webhook,
  getPaymentHistory,
};
