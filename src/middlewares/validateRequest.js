const { ZodError } = require("zod");

const { normalizeValidationDetails, sendError } = require("../utils/http");

const parseWithSchema = (schema, value) => {
  if (!schema) return { success: true, data: value };
  return schema.safeParse(value);
};

function validateRequest(schemas = {}) {
  return (req, res, next) => {
    const targets = ["params", "query", "body"];

    for (const target of targets) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = parseWithSchema(schema, req[target]);
      if (!result.success) {
        const issues = result.error instanceof ZodError ? result.error.issues : [];
        return sendError(res, {
          status: 400,
          code: "VALIDATION_ERROR",
          message: "La solicitud contiene datos inválidos.",
          details: normalizeValidationDetails(issues),
        });
      }

      req[target] = result.data;
    }

    return next();
  };
}

module.exports = validateRequest;
