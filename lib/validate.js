export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function requireFields(obj, fieldNames) {
  return fieldNames.filter((name) => {
    const value = obj?.[name];
    return value === undefined || value === null || value === "";
  });
}

// Matches Stripe secret-key-shaped substrings: the three secret prefixes
// actually used in this codebase (STRIPE_SECRET_KEY values start with
// sk_live_/sk_test_, STRIPE_WEBHOOK_SECRET values start with whsec_) followed
// by the alphanumeric/underscore key body. Used to scrub error messages
// before they reach server logs, in case an underlying error ever echoes
// back part of a misconfigured or invalid key.
const SECRET_PATTERN = /(?:sk_live_|sk_test_|whsec_)[A-Za-z0-9_]+/g;

export function redactSecrets(message) {
  if (typeof message !== "string") return message;
  return message.replace(SECRET_PATTERN, "[REDACTED]");
}
