import type { IRColumn, IRTable } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, pascal } from '../ir'

// ---- JSON Schema (draft 2020-12) --------------------------------------------

function jsonProp(c: IRColumn): Record<string, unknown> {
  const base = (): Record<string, unknown> => {
    switch (c.kind) {
      case 'int':
      case 'bigint':
        return { type: 'integer' }
      case 'float':
      case 'decimal':
        return { type: 'number' }
      case 'bool':
        return { type: 'boolean' }
      case 'uuid':
        return { type: 'string', format: 'uuid' }
      case 'date':
        return { type: 'string', format: 'date' }
      case 'datetime':
        return { type: 'string', format: 'date-time' }
      case 'time':
        return { type: 'string', format: 'time' }
      case 'json':
        return { type: 'object' }
      case 'bytes':
        return { type: 'string', contentEncoding: 'base64' }
      default:
        return { type: 'string' }
    }
  }
  const p = base()
  if (c.nullable) {
    const t = p.type
    p.type = Array.isArray(t) ? [...t, 'null'] : [t as string, 'null']
  }
  return p
}

export const jsonSchema: GenFn = (tables): GeneratedFile[] => {
  const defs: Record<string, unknown> = {}
  for (const t of tables) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const c of t.columns) {
      properties[c.name] = jsonProp(c)
      if (!c.nullable) required.push(c.name)
    }
    defs[modelName(t.name)] = { type: 'object', properties, required, additionalProperties: false }
  }
  const doc =
    tables.length === 1
      ? { $schema: 'https://json-schema.org/draft/2020-12/schema', ...(Object.values(defs)[0] as object) }
      : { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: defs }
  return [{ filename: 'schema.json', lang: 'json', content: JSON.stringify(doc, null, 2) + '\n' }]
}

// ---- OpenAPI 3 component schemas (YAML) -------------------------------------

function openapiLines(c: IRColumn, indent: string): string {
  const l: string[] = []
  let type = 'string'
  let format = ''
  switch (c.kind) {
    case 'int':
      type = 'integer'
      format = 'int32'
      break
    case 'bigint':
      type = 'integer'
      format = 'int64'
      break
    case 'float':
      type = 'number'
      format = 'double'
      break
    case 'decimal':
      type = 'number'
      break
    case 'bool':
      type = 'boolean'
      break
    case 'uuid':
      format = 'uuid'
      break
    case 'date':
      format = 'date'
      break
    case 'datetime':
      format = 'date-time'
      break
    case 'bytes':
      format = 'byte'
      break
    case 'json':
      type = 'object'
      break
  }
  l.push(`${indent}type: ${type}`)
  if (format) l.push(`${indent}format: ${format}`)
  if (c.nullable) l.push(`${indent}nullable: true`)
  return l.join('\n')
}

export const openapiSchema: GenFn = (tables): GeneratedFile[] => {
  const schemas = tables
    .map((t) => {
      const props = t.columns
        .map((c) => `        ${c.name}:\n${openapiLines(c, '          ')}`)
        .join('\n')
      const required = t.columns.filter((c) => !c.nullable).map((c) => `        - ${c.name}`)
      const req = required.length ? `\n      required:\n${required.join('\n')}` : ''
      return `    ${modelName(t.name)}:\n      type: object\n      properties:\n${props}${req}`
    })
    .join('\n')
  return [
    { filename: 'openapi-schemas.yaml', lang: 'yaml', content: `components:\n  schemas:\n${schemas}\n` }
  ]
}

// ---- GraphQL SDL ------------------------------------------------------------

function graphqlType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'int':
      base = 'Int'
      break
    case 'bigint':
      base = 'Int'
      break
    case 'float':
    case 'decimal':
      base = 'Float'
      break
    case 'bool':
      base = 'Boolean'
      break
    case 'uuid':
      base = c.isPrimaryKey ? 'ID' : 'String'
      break
    case 'date':
    case 'datetime':
    case 'time':
      base = 'DateTime'
      break
    case 'json':
      base = 'JSON'
      break
    default:
      base = c.isPrimaryKey ? 'ID' : 'String'
  }
  return base + (c.nullable ? '' : '!')
}

export const graphqlSdl: GenFn = (tables): GeneratedFile[] => {
  const needScalars = new Set<string>()
  const types = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const ty = graphqlType(c)
          if (ty.startsWith('DateTime')) needScalars.add('DateTime')
          if (ty.startsWith('JSON')) needScalars.add('JSON')
          return `  ${camelGql(c.name)}: ${ty}`
        })
        .join('\n')
      return `type ${modelName(t.name)} {\n${rows}\n}`
    })
    .join('\n\n')
  const scalars = [...needScalars].map((s) => `scalar ${s}`).join('\n')
  const content = (scalars ? scalars + '\n\n' : '') + types + '\n'
  return [{ filename: 'schema.graphql', lang: 'graphql', content }]
}

function camelGql(name: string): string {
  // GraphQL fields are conventionally camelCase.
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// ---- Protocol Buffers (proto3) ----------------------------------------------

function protoType(c: IRColumn): string {
  switch (c.kind) {
    case 'int':
      return 'int32'
    case 'bigint':
      return 'int64'
    case 'float':
      return 'double'
    case 'decimal':
      return 'string'
    case 'bool':
      return 'bool'
    case 'bytes':
      return 'bytes'
    case 'json':
      return 'string'
    case 'datetime':
    case 'date':
    case 'time':
      return 'string'
    default:
      return 'string'
  }
}

export const protobuf: GenFn = (tables): GeneratedFile[] => {
  const messages = tables
    .map((t: IRTable) => {
      const rows = t.columns
        .map((c, i) => {
          const opt = c.nullable ? 'optional ' : ''
          return `  ${opt}${protoType(c)} ${c.name} = ${i + 1};`
        })
        .join('\n')
      return `message ${pascal(modelName(t.name))} {\n${rows}\n}`
    })
    .join('\n\n')
  return [{ filename: 'schema.proto', lang: 'protobuf', content: `syntax = "proto3";\n\n${messages}\n` }]
}
