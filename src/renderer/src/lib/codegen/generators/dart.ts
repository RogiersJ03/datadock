import type { IRColumn } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, camel } from '../ir'

function dartType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'string':
    case 'text':
    case 'uuid':
      base = 'String'
      break
    case 'int':
    case 'bigint':
      base = 'int'
      break
    case 'float':
      base = 'double'
      break
    case 'decimal':
      base = 'num'
      break
    case 'bool':
      base = 'bool'
      break
    case 'date':
    case 'datetime':
    case 'time':
      base = 'DateTime'
      break
    case 'json':
      base = 'Map<String, dynamic>'
      break
    case 'bytes':
      base = 'List<int>'
      break
    default:
      base = 'String'
  }
  return base + (c.nullable ? '?' : '')
}

function fromJsonExpr(c: IRColumn): string {
  const key = `json['${c.name}']`
  switch (c.kind) {
    case 'int':
    case 'bigint':
      return c.nullable ? `${key} as int?` : `${key} as int`
    case 'float':
      return c.nullable ? `(${key} as num?)?.toDouble()` : `(${key} as num).toDouble()`
    case 'decimal':
      return c.nullable ? `${key} as num?` : `${key} as num`
    case 'bool':
      return c.nullable ? `${key} as bool?` : `${key} as bool`
    case 'date':
    case 'datetime':
    case 'time':
      return c.nullable
        ? `${key} == null ? null : DateTime.parse(${key} as String)`
        : `DateTime.parse(${key} as String)`
    case 'json':
      return c.nullable ? `${key} as Map<String, dynamic>?` : `${key} as Map<String, dynamic>`
    default:
      return c.nullable ? `${key} as String?` : `${key} as String`
  }
}

function toJsonExpr(c: IRColumn): string {
  const f = camel(c.name)
  if (['date', 'datetime', 'time'].includes(c.kind))
    return c.nullable ? `${f}?.toIso8601String()` : `${f}.toIso8601String()`
  return f
}

export const dartData: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const cls = modelName(t.name)
      const fields = t.columns.map((c) => `  final ${dartType(c)} ${camel(c.name)};`).join('\n')
      const ctorArgs = t.columns
        .map((c) => (c.nullable ? `    this.${camel(c.name)},` : `    required this.${camel(c.name)},`))
        .join('\n')
      const fromJson = t.columns.map((c) => `        ${camel(c.name)}: ${fromJsonExpr(c)},`).join('\n')
      const toJson = t.columns.map((c) => `        '${c.name}': ${toJsonExpr(c)},`).join('\n')
      return `class ${cls} {
${fields}

  ${cls}({
${ctorArgs}
  });

  factory ${cls}.fromJson(Map<String, dynamic> json) => ${cls}(
${fromJson}
      );

  Map<String, dynamic> toJson() => {
${toJson}
      };
}`
    })
    .join('\n\n')
  return [{ filename: 'models.dart', lang: 'dart', content: body + '\n' }]
}
