export class AppError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details; }
}
export function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function identifier(value, label) {
  const id = requiredText(value, label, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new AppError(`${label} is invalid.`);
  return id;
}
