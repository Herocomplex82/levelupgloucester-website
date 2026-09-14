export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function requireFields(obj, fieldNames) {
  return fieldNames.filter((name) => {
    const value = obj?.[name];
    return value === undefined || value === null || value === "";
  });
}
