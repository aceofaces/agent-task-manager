import { z, type ZodTypeAny } from 'zod';

/**
 * Convert a Zod schema to JSON schema without $ref indirection.
 * Relies on the native helper shipped with Zod v4.
 */
export function zodToJson(schema: ZodTypeAny): unknown {
  const toJSONSchema = (z as unknown as {
    toJSONSchema?: (schema: ZodTypeAny, options?: unknown) => unknown;
  }).toJSONSchema;

  if (typeof toJSONSchema !== 'function') {
    throw new Error('Zod v4 `z.toJSONSchema` helper not available.');
  }

  return toJSONSchema(schema, {
    $refStrategy: 'none',
    io: 'input',
    unrepresentable: 'passthrough',
  });
}

export default zodToJson;
