function canonicalValue(value: unknown, stack: WeakSet<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Non-JSON value at ${path}`);
  }
  if (stack.has(value)) throw new TypeError(`Circular value at ${path}`);

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item, index) => canonicalValue(item, stack, `${path}[${index}]`))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalValue(record[key], stack, `${path}.${key}`)}`,
      )
      .join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

/** Stable JSON encoding with sorted object keys; rejects lossy/non-JSON payloads. */
export function canonicalStringify(value: unknown): string {
  return canonicalValue(value, new WeakSet<object>(), "$");
}

/**
 * Fast corruption checksum. It is an integrity signal, not a cryptographic signature.
 * FNV-1a is applied to UTF-8 bytes so Node and browsers produce the same result.
 */
export function checksum(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}
