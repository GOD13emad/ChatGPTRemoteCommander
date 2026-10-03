function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function pathProperty(base, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

function sameJsonScalar(a, b) {
  return Object.is(a, b);
}

export function validateJsonSchema(value, schema, at = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [`${at}: invalid internal schema`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => sameJsonScalar(item, value))) {
    errors.push(`${at}: expected one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
    return errors;
  }

  if (schema.type) {
    let typeOk = false;
    switch (schema.type) {
      case 'object': typeOk = value !== null && typeof value === 'object' && !Array.isArray(value); break;
      case 'array': typeOk = Array.isArray(value); break;
      case 'string': typeOk = typeof value === 'string'; break;
      case 'boolean': typeOk = typeof value === 'boolean'; break;
      case 'integer': typeOk = Number.isInteger(value); break;
      case 'number': typeOk = typeof value === 'number' && Number.isFinite(value); break;
      case 'null': typeOk = value === null; break;
      default:
        errors.push(`${at}: unsupported internal schema type ${JSON.stringify(schema.type)}`);
        return errors;
    }
    if (!typeOk) {
      errors.push(`${at}: expected ${schema.type}, received ${typeName(value)}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${at}: string length must be >= ${schema.minLength}`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${at}: string length must be <= ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      let regex;
      try { regex = new RegExp(schema.pattern); }
      catch { errors.push(`${at}: invalid internal schema pattern`); return errors; }
      if (!regex.test(value)) errors.push(`${at}: string does not match required pattern`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${at}: number must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${at}: number must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${at}: array length must be >= ${schema.minItems}`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${at}: array length must be <= ${schema.maxItems}`);
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, schema.items, `${at}[${index}]`));
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${pathProperty(at, key)}: required property is missing`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${pathProperty(at, key)}: additional property is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateJsonSchema(value[key], childSchema, pathProperty(at, key)));
      }
    }
  }

  return errors;
}

export function formatToolInputErrors(toolName, errors, maxErrors = 8) {
  const visible = errors.slice(0, maxErrors);
  const suffix = errors.length > visible.length ? `; +${errors.length - visible.length} more` : '';
  return `Input validation error: Invalid arguments for tool ${toolName}: ${visible.join('; ')}${suffix}`;
}
