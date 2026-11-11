import type { LogData } from "../interfaces/interfaces.js";

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const MAX_DEPTH = 20;

function matches(path: string[], key: string, patterns: readonly string[]): boolean {
  const fullPath = [...path, key].map(part => part.toLowerCase());
  return patterns.some(pattern => {
    let parts = pattern.toLowerCase().split(".");
    if (["context", "data", "error"].includes(parts[0]) && parts.length > 1) parts = parts.slice(1);
    if (parts.length === 1) return fullPath.at(-1) === parts[0];
    if (parts.length > fullPath.length) return false;
    const suffix = fullPath.slice(-parts.length);
    return parts.every((part, index) => part === "*" || part === suffix[index]);
  });
}

/** Redacts configured object fields and converts values into bounded JSON-safe data. */
export function sanitize(value: unknown, patterns: readonly string[] = [], rootPath: string[] = []): unknown {
  const ancestors = new WeakSet<object>();

  const visit = (input: unknown, path: string[], depth: number): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined") return "[undefined]";
    if (typeof input === "symbol") return input.toString();
    if (typeof input === "function") return `[Function${input.name ? `: ${input.name}` : ""}]`;
    if (depth >= MAX_DEPTH) return "[MaxDepth]";

    if (input instanceof Date) return Number.isNaN(input.getTime()) ? "[Invalid Date]" : input.toISOString();
    if (input instanceof URL) return input.toString();
    if (input instanceof Error) {
      if (ancestors.has(input)) return CIRCULAR;
      ancestors.add(input);
      const result: Record<string, unknown> = {};
      const standard: Array<[string, unknown]> = [["name", input.name], ["message", input.message]];
      if (input.stack) standard.push(["stack", input.stack]);
      if ("cause" in input) standard.push(["cause", input.cause]);
      const redactMessage = matches(path, "message", patterns);
      for (const [key, item] of standard) {
        if (key === "stack" && redactMessage && typeof item === "string") {
          result[key] = item.replace(/^[^\r\n]*/, `${input.name}: ${REDACTED}`);
        } else {
          result[key] = matches(path, key, patterns) ? REDACTED : visit(item, [...path, key], depth + 1);
        }
      }
      for (const key of Object.keys(input)) {
        if (["name", "message", "stack", "cause"].includes(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor)) { result[key] = "[Accessor]"; continue; }
        result[key] = matches(path, key, patterns) ? REDACTED : visit(descriptor.value, [...path, key], depth + 1);
      }
      ancestors.delete(input);
      return result;
    }
    if (input instanceof Uint8Array) return Buffer.from(input).toString("base64");
    if (ancestors.has(input)) return CIRCULAR;
    ancestors.add(input);

    if (Array.isArray(input)) {
      const result = input.map((item, index) => matches(path, String(index), patterns)
        ? REDACTED
        : visit(item, [...path, String(index)], depth + 1));
      ancestors.delete(input);
      return result;
    }
    if (input instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of input) {
        const name = String(key);
        result[name] = matches(path, name, patterns) ? REDACTED : visit(item, [...path, name], depth + 1);
      }
      ancestors.delete(input);
      return result;
    }
    if (input instanceof Set) {
      const result = [...input].map((item, index) => visit(item, [...path, String(index)], depth + 1));
      ancestors.delete(input);
      return result;
    }

    const result: LogData = {};
    for (const key of Object.keys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) { result[key] = "[Accessor]"; continue; }
      result[key] = matches(path, key, patterns) ? REDACTED : visit(descriptor.value, [...path, key], depth + 1);
    }
    ancestors.delete(input);
    return result;
  };

  return visit(value, rootPath, 0);
}

export function serializeError(error: unknown, patterns: readonly string[] = []): Record<string, unknown> | undefined {
  if (error === undefined || error === null) return undefined;
  const sanitized = sanitize(error, patterns, ["error"]);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { name: "Error", message: String(sanitized) };
}
