export class WoaChatError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WoaChatError";
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(error) {
  return {
    status: "error",
    code: error && error.code ? String(error.code) : "UNEXPECTED_ERROR",
    message: error && error.message ? String(error.message) : String(error),
    ...(error && error.details && Object.keys(error.details).length
      ? { details: error.details }
      : {})
  };
}
