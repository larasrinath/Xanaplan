/*
 * Copyright 2026 Lara Srinath
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
