import type { IRTable, IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, camel, pascal } from '../ir'
import { createTableSql, dialectOf } from './sql'

// ---- shared TS type mapping -------------------------------------------------

function tsType(k: ScalarKind): string {
  switch (k) {
    case 'string':
    case 'text':
    case 'uuid':
    case 'decimal': // string-safe for precision; commonly serialized as string
      return k === 'decimal' ? 'number' : 'string'
    case 'int':
    case 'bigint':
    case 'float':
      return 'number'
    case 'bool':
      return 'boolean'
    case 'date':
    case 'datetime':
    case 'time':
      return 'Date'
    case 'json':
      return 'Record<string, unknown>'
    case 'bytes':
      return 'Uint8Array'
    default:
      return 'unknown'
  }
}

const fieldType = (c: IRColumn): string => tsType(c.kind) + (c.nullable ? ' | null' : '')

// ---- plain interface --------------------------------------------------------

export const tsInterface: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const rows = t.columns.map((c) => `  ${c.name}: ${fieldType(c)}`).join('\n')
      return `export interface ${modelName(t.name)} {\n${rows}\n}`
    })
    .join('\n\n')
  return [{ filename: 'models.ts', lang: 'ts', content: body + '\n' }]
}

// ---- Zod --------------------------------------------------------------------

function zodExpr(c: IRColumn): string {
  let e: string
  switch (c.kind) {
    case 'string':
    case 'text':
      e = 'z.string()'
      break
    case 'uuid':
      e = 'z.string().uuid()'
      break
    case 'int':
      e = 'z.number().int()'
      break
    case 'bigint':
      e = 'z.coerce.bigint()'
      break
    case 'float':
    case 'decimal':
      e = 'z.number()'
      break
    case 'bool':
      e = 'z.boolean()'
      break
    case 'date':
    case 'datetime':
      e = 'z.coerce.date()'
      break
    case 'time':
      e = 'z.string()'
      break
    case 'json':
      e = 'z.record(z.string(), z.unknown())'
      break
    case 'bytes':
      e = 'z.instanceof(Uint8Array)'
      break
    default:
      e = 'z.unknown()'
  }
  if (c.nullable) e += '.nullable()'
  return e
}

export const tsZod: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const name = modelName(t.name)
      const rows = t.columns.map((c) => `  ${c.name}: ${zodExpr(c)}`).join(',\n')
      return `export const ${camel(name)}Schema = z.object({\n${rows}\n})\n\nexport type ${name} = z.infer<typeof ${camel(name)}Schema>`
    })
    .join('\n\n')
  return [{ filename: 'schemas.ts', lang: 'ts', content: `import { z } from 'zod'\n\n${body}\n` }]
}

// ---- Prisma -----------------------------------------------------------------

function prismaType(c: IRColumn): string {
  const map: Record<ScalarKind, string> = {
    string: 'String',
    text: 'String',
    uuid: 'String',
    int: 'Int',
    bigint: 'BigInt',
    float: 'Float',
    decimal: 'Decimal',
    bool: 'Boolean',
    date: 'DateTime',
    datetime: 'DateTime',
    time: 'DateTime',
    json: 'Json',
    bytes: 'Bytes',
    enum: 'String',
    unknown: 'String'
  }
  return map[c.kind] + (c.nullable ? '?' : '')
}

export const tsPrisma: GenFn = (tables): GeneratedFile[] => {
  const models = tables
    .map((t) => {
      const lines = t.columns.map((c) => {
        let line = `  ${camel(c.name)} ${prismaType(c)}`
        const attrs: string[] = []
        if (c.isPrimaryKey && t.primaryKey.length === 1) attrs.push('@id')
        if (c.autoIncrement) attrs.push('@default(autoincrement())')
        if (c.unique && !c.isPrimaryKey) attrs.push('@unique')
        if (camel(c.name) !== c.name) attrs.push(`@map("${c.name}")`)
        if (attrs.length) line += ' ' + attrs.join(' ')
        return line
      })
      // Relation fields from foreign keys.
      for (const c of t.columns) {
        if (!c.ref) continue
        const rel = modelName(c.ref.table)
        lines.push(
          `  ${camel(singularField(c.ref.table))} ${rel}${c.nullable ? '?' : ''} @relation(fields: [${camel(c.name)}], references: [${camel(c.ref.column)}])`
        )
      }
      if (t.primaryKey.length > 1) lines.push(`  @@id([${t.primaryKey.map(camel).join(', ')}])`)
      if (pascal(t.name) !== t.name) lines.push(`  @@map("${t.name}")`)
      return `model ${modelName(t.name)} {\n${lines.join('\n')}\n}`
    })
    .join('\n\n')
  const header =
    '// Paste these models into your schema.prisma (below the datasource/generator blocks).\n\n'
  return [{ filename: 'schema.prisma', lang: 'prisma', content: header + models + '\n' }]
}

function singularField(table: string): string {
  return modelName(table).charAt(0).toLowerCase() + modelName(table).slice(1)
}

// ---- TypeORM ----------------------------------------------------------------

function typeormColumnType(c: IRColumn): string {
  const map: Partial<Record<ScalarKind, string>> = {
    string: 'varchar',
    text: 'text',
    uuid: 'uuid',
    int: 'int',
    bigint: 'bigint',
    float: 'float',
    decimal: 'decimal',
    bool: 'boolean',
    date: 'date',
    datetime: 'timestamp',
    time: 'time',
    json: 'json',
    bytes: 'bytea'
  }
  return map[c.kind] ?? 'varchar'
}

export const tsTypeorm: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    const body = tables
      .map((t) => {
        const cls = modelName(t.name)
        const rows = t.columns
          .map((c) => {
            let dec: string
            if (c.isPrimaryKey && c.autoIncrement) dec = '  @PrimaryGeneratedColumn()'
            else if (c.isPrimaryKey) dec = `  @PrimaryColumn({ type: '${typeormColumnType(c)}' })`
            else {
              const props = [`type: '${typeormColumnType(c)}'`]
              if (c.nullable) props.push('nullable: true')
              if (c.unique && !c.isPrimaryKey) props.push('unique: true')
              dec = `  @Column({ ${props.join(', ')} })`
            }
            return `${dec}\n  ${camel(c.name)}: ${fieldType(c)}`
          })
          .join('\n\n')
        return `@Entity({ name: '${t.name}' })\nexport class ${cls} {\n${rows}\n}`
      })
      .join('\n\n')
    const imports =
      "import { Entity, Column, PrimaryGeneratedColumn, PrimaryColumn } from 'typeorm'\n\n"
    files.push({ filename: 'entities.ts', lang: 'ts', content: imports + body + '\n' })
  }
  if (opts.kinds.includes('migration')) {
    const d = dialectOf(opts.driver)
    const up = tables
      .map((t) => `    await queryRunner.query(\`${createTableSql(t, d).replace(/`/g, '\\`')}\`)`)
      .join('\n')
    const down = [...tables]
      .reverse()
      .map((t) => `    await queryRunner.query(\`DROP TABLE "${t.name}"\`)`)
      .join('\n')
    const ts = Date.now()
    const content = `import { MigrationInterface, QueryRunner } from 'typeorm'\n\nexport class CreateTables${ts} implements MigrationInterface {\n  public async up(queryRunner: QueryRunner): Promise<void> {\n${up}\n  }\n\n  public async down(queryRunner: QueryRunner): Promise<void> {\n${down}\n  }\n}\n`
    files.push({ filename: `${ts}-CreateTables.ts`, lang: 'ts', content })
  }
  return files
}

// ---- Sequelize --------------------------------------------------------------

function sequelizeType(c: IRColumn): string {
  const map: Partial<Record<ScalarKind, string>> = {
    string: c.length ? `DataTypes.STRING(${c.length})` : 'DataTypes.STRING',
    text: 'DataTypes.TEXT',
    uuid: 'DataTypes.UUID',
    int: 'DataTypes.INTEGER',
    bigint: 'DataTypes.BIGINT',
    float: 'DataTypes.FLOAT',
    decimal: `DataTypes.DECIMAL(${c.precision ?? 18}, ${c.scale ?? 2})`,
    bool: 'DataTypes.BOOLEAN',
    date: 'DataTypes.DATEONLY',
    datetime: 'DataTypes.DATE',
    time: 'DataTypes.TIME',
    json: 'DataTypes.JSON',
    bytes: 'DataTypes.BLOB'
  }
  return map[c.kind] ?? 'DataTypes.STRING'
}

export const tsSequelize: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    const body = tables
      .map((t) => {
        const rows = t.columns
          .map((c) => {
            const props = [`type: ${sequelizeType(c)}`]
            if (c.isPrimaryKey) props.push('primaryKey: true')
            if (c.autoIncrement) props.push('autoIncrement: true')
            if (!c.nullable) props.push('allowNull: false')
            if (c.unique && !c.isPrimaryKey) props.push('unique: true')
            return `    ${c.name}: { ${props.join(', ')} }`
          })
          .join(',\n')
        return `export const ${modelName(t.name)} = sequelize.define('${modelName(t.name)}', {\n${rows}\n  }, { tableName: '${t.name}', timestamps: ${t.hasTimestamps} })`
      })
      .join('\n\n')
    const imports =
      "import { Sequelize, DataTypes } from 'sequelize'\n\n// const sequelize = new Sequelize(/* ... */)\n\n"
    files.push({ filename: 'models.ts', lang: 'ts', content: imports + body + '\n' })
  }
  if (opts.kinds.includes('migration')) {
    const created = tables
      .map((t) => {
        const rows = t.columns
          .map((c) => {
            const props = [`type: ${sequelizeType(c)}`]
            if (c.isPrimaryKey) props.push('primaryKey: true')
            if (c.autoIncrement) props.push('autoIncrement: true')
            if (!c.nullable) props.push('allowNull: false')
            return `      ${c.name}: { ${props.join(', ')} }`
          })
          .join(',\n')
        return `    await queryInterface.createTable('${t.name}', {\n${rows}\n    })`
      })
      .join('\n')
    const dropped = [...tables]
      .reverse()
      .map((t) => `    await queryInterface.dropTable('${t.name}')`)
      .join('\n')
    const content = `'use strict'\nconst { DataTypes } = require('sequelize')\n\nmodule.exports = {\n  async up(queryInterface, Sequelize) {\n${created}\n  },\n  async down(queryInterface, Sequelize) {\n${dropped}\n  }\n}\n`
    files.push({ filename: 'migration.js', lang: 'ts', content })
  }
  return files
}

// ---- Knex -------------------------------------------------------------------

function knexCall(c: IRColumn): string {
  const n = `'${c.name}'`
  switch (c.kind) {
    case 'string':
      return c.length ? `string(${n}, ${c.length})` : `string(${n})`
    case 'text':
      return `text(${n})`
    case 'uuid':
      return `uuid(${n})`
    case 'int':
      return `integer(${n})`
    case 'bigint':
      return `bigInteger(${n})`
    case 'float':
      return `float(${n})`
    case 'decimal':
      return `decimal(${n}, ${c.precision ?? 18}, ${c.scale ?? 2})`
    case 'bool':
      return `boolean(${n})`
    case 'date':
      return `date(${n})`
    case 'datetime':
      return `datetime(${n})`
    case 'time':
      return `time(${n})`
    case 'json':
      return `jsonb(${n})`
    case 'bytes':
      return `binary(${n})`
    default:
      return `specificType(${n}, '${c.rawType}')`
  }
}

export const tsKnex: GenFn = (tables): GeneratedFile[] => {
  const up = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          if (c.autoIncrement && c.isPrimaryKey) {
            return c.kind === 'bigint'
              ? `    table.bigIncrements('${c.name}')`
              : `    table.increments('${c.name}')`
          }
          let line = `    table.${knexCall(c)}`
          if (c.isPrimaryKey && t.primaryKey.length === 1) line += '.primary()'
          if (!c.nullable) line += '.notNullable()'
          if (c.unique && !c.isPrimaryKey) line += '.unique()'
          if (c.ref) line += `.references('${c.ref.column}').inTable('${c.ref.table}')`
          return line
        })
        .join('\n')
      const composite =
        t.primaryKey.length > 1 ? `\n    table.primary([${t.primaryKey.map((k) => `'${k}'`).join(', ')}])` : ''
      const ts = t.hasTimestamps ? '\n    table.timestamps(true, true)' : ''
      return `  await knex.schema.createTable('${t.name}', (table) => {\n${rows}${composite}${ts}\n  })`
    })
    .join('\n')
  const down = [...tables]
    .reverse()
    .map((t) => `  await knex.schema.dropTableIfExists('${t.name}')`)
    .join('\n')
  const content = `import type { Knex } from 'knex'\n\nexport async function up(knex: Knex): Promise<void> {\n${up}\n}\n\nexport async function down(knex: Knex): Promise<void> {\n${down}\n}\n`
  return [{ filename: 'migration.ts', lang: 'ts', content }]
}

// ---- Drizzle ----------------------------------------------------------------

export const tsDrizzle: GenFn = (tables, opts): GeneratedFile[] => {
  const d = dialectOf(opts.driver)
  const core = d === 'mysql' ? 'mysql-core' : d === 'sqlite' ? 'sqlite-core' : 'pg-core'
  const tableFn = d === 'mysql' ? 'mysqlTable' : d === 'sqlite' ? 'sqliteTable' : 'pgTable'

  function col(c: IRColumn): string {
    const n = `'${c.name}'`
    let base: string
    if (c.autoIncrement && d === 'postgres') base = c.kind === 'bigint' ? `bigserial(${n}, { mode: 'number' })` : `serial(${n})`
    else
      switch (c.kind) {
        case 'string':
          base = d === 'sqlite' ? `text(${n})` : `varchar(${n}${c.length ? `, { length: ${c.length} }` : ''})`
          break
        case 'text':
          base = `text(${n})`
          break
        case 'uuid':
          base = d === 'postgres' ? `uuid(${n})` : `text(${n})`
          break
        case 'int':
          base = d === 'sqlite' ? `integer(${n})` : `integer(${n})`
          break
        case 'bigint':
          base = d === 'sqlite' ? `integer(${n})` : `bigint(${n}, { mode: 'number' })`
          break
        case 'float':
          base = d === 'postgres' ? `doublePrecision(${n})` : `real(${n})`
          break
        case 'decimal':
          base = d === 'sqlite' ? `real(${n})` : `decimal(${n}, { precision: ${c.precision ?? 18}, scale: ${c.scale ?? 2} })`
          break
        case 'bool':
          base = d === 'sqlite' ? `integer(${n}, { mode: 'boolean' })` : `boolean(${n})`
          break
        case 'date':
          base = d === 'sqlite' ? `text(${n})` : `date(${n})`
          break
        case 'datetime':
          base = d === 'sqlite' ? `integer(${n}, { mode: 'timestamp' })` : `timestamp(${n})`
          break
        case 'time':
          base = d === 'sqlite' ? `text(${n})` : `time(${n})`
          break
        case 'json':
          base = d === 'mysql' ? `json(${n})` : d === 'sqlite' ? `text(${n}, { mode: 'json' })` : `jsonb(${n})`
          break
        case 'bytes':
          base = d === 'sqlite' ? `blob(${n})` : `text(${n})`
          break
        default:
          base = `text(${n})`
      }
    if (c.isPrimaryKey && t_singlePk(c)) base += '.primaryKey()'
    if (!c.nullable && !c.autoIncrement) base += '.notNull()'
    if (c.unique && !c.isPrimaryKey) base += '.unique()'
    return base
  }
  // Track single-PK per table via closure map.
  const singlePkTables = new Set(tables.filter((t) => t.primaryKey.length === 1).map((t) => t.name))
  let currentTable: IRTable
  function t_singlePk(c: IRColumn): boolean {
    return c.isPrimaryKey && singlePkTables.has(currentTable.name)
  }

  const usedFns = new Set<string>([tableFn])
  const body = tables
    .map((t) => {
      currentTable = t
      const rows = t.columns.map((c) => {
        const expr = col(c)
        const fn = expr.match(/^[a-zA-Z]+/)?.[0]
        if (fn) usedFns.add(fn)
        return `  ${camel(c.name)}: ${expr}`
      })
      if (t.primaryKey.length > 1) {
        usedFns.add('primaryKey')
        rows.push(
          `}, (table) => ({\n  pk: primaryKey({ columns: [${t.primaryKey.map((k) => `table.${camel(k)}`).join(', ')}] })\n})`
        )
        return `export const ${camel(t.name)} = ${tableFn}('${t.name}', {\n${rows.slice(0, -1).join(',\n')}\n${rows[rows.length - 1]})`
      }
      return `export const ${camel(t.name)} = ${tableFn}('${t.name}', {\n${rows.join(',\n')}\n})`
    })
    .join('\n\n')
  const imports = `import { ${[...usedFns].sort().join(', ')} } from 'drizzle-orm/${core}'\n\n`
  return [{ filename: 'schema.ts', lang: 'ts', content: imports + body + '\n' }]
}

// ---- Pinia store ------------------------------------------------------------

export const tsPinia: GenFn = (tables): GeneratedFile[] => {
  const iface = tables
    .map((t) => {
      const rows = t.columns.map((c) => `  ${c.name}: ${fieldType(c)}`).join('\n')
      return `export interface ${modelName(t.name)} {\n${rows}\n}`
    })
    .join('\n\n')
  const stores = tables
    .map((t) => {
      const name = modelName(t.name)
      const pk = t.primaryKey[0] ?? 'id'
      return `export const use${name}Store = defineStore('${camel(name)}', () => {
  const items = ref<${name}[]>([])
  const byId = computed(() => new Map(items.value.map((i) => [i.${pk}, i])))

  function set(rows: ${name}[]): void {
    items.value = rows
  }
  function upsert(row: ${name}): void {
    const i = items.value.findIndex((r) => r.${pk} === row.${pk})
    if (i === -1) items.value.push(row)
    else items.value[i] = row
  }
  function remove(id: ${name}['${pk}']): void {
    items.value = items.value.filter((r) => r.${pk} !== id)
  }

  return { items, byId, set, upsert, remove }
})`
    })
    .join('\n\n')
  const content = `import { defineStore } from 'pinia'\nimport { ref, computed } from 'vue'\n\n${iface}\n\n${stores}\n`
  return [{ filename: 'stores.ts', lang: 'ts', content }]
}

// ---- Zustand store ----------------------------------------------------------

export const tsZustand: GenFn = (tables): GeneratedFile[] => {
  const iface = tables
    .map((t) => {
      const rows = t.columns.map((c) => `  ${c.name}: ${fieldType(c)}`).join('\n')
      return `export interface ${modelName(t.name)} {\n${rows}\n}`
    })
    .join('\n\n')
  const stores = tables
    .map((t) => {
      const name = modelName(t.name)
      const pk = t.primaryKey[0] ?? 'id'
      const plural = camel(t.name)
      return `interface ${name}State {
  ${plural}: ${name}[]
  set${name}s: (rows: ${name}[]) => void
  upsert${name}: (row: ${name}) => void
  remove${name}: (id: ${name}['${pk}']) => void
}

export const use${name}Store = create<${name}State>((set) => ({
  ${plural}: [],
  set${name}s: (rows) => set({ ${plural}: rows }),
  upsert${name}: (row) =>
    set((s) => {
      const i = s.${plural}.findIndex((r) => r.${pk} === row.${pk})
      if (i === -1) return { ${plural}: [...s.${plural}, row] }
      const next = s.${plural}.slice()
      next[i] = row
      return { ${plural}: next }
    }),
  remove${name}: (id) => set((s) => ({ ${plural}: s.${plural}.filter((r) => r.${pk} !== id) }))
}))`
    })
    .join('\n\n')
  const content = `import { create } from 'zustand'\n\n${iface}\n\n${stores}\n`
  return [{ filename: 'stores.ts', lang: 'ts', content }]
}

// ---- Kysely -----------------------------------------------------------------

export const tsKysely: GenFn = (tables): GeneratedFile[] => {
  const usesGenerated = tables.some((t) => t.columns.some((c) => c.autoIncrement && c.isPrimaryKey))
  const ifaces = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          if (c.autoIncrement && c.isPrimaryKey) return `  ${c.name}: Generated<${tsType(c.kind)}>`
          return `  ${c.name}: ${fieldType(c)}`
        })
        .join('\n')
      return `export interface ${modelName(t.name)}Table {\n${rows}\n}`
    })
    .join('\n\n')
  const dbRows = tables.map((t) => `  ${t.name}: ${modelName(t.name)}Table`).join('\n')
  const imports = usesGenerated ? "import { Generated } from 'kysely'\n\n" : ''
  const db = `export interface Database {\n${dbRows}\n}`
  return [{ filename: 'db.ts', lang: 'ts', content: `${imports}${ifaces}\n\n${db}\n` }]
}

// ---- class-validator DTO (NestJS) -------------------------------------------

function validatorDecorator(c: IRColumn): { dec: string; name: string } {
  switch (c.kind) {
    case 'int':
    case 'bigint':
      return { dec: '@IsInt()', name: 'IsInt' }
    case 'float':
    case 'decimal':
      return { dec: '@IsNumber()', name: 'IsNumber' }
    case 'bool':
      return { dec: '@IsBoolean()', name: 'IsBoolean' }
    case 'uuid':
      return { dec: '@IsUUID()', name: 'IsUUID' }
    case 'date':
    case 'datetime':
    case 'time':
      return { dec: '@IsDate()', name: 'IsDate' }
    case 'json':
      return { dec: '@IsObject()', name: 'IsObject' }
    default:
      return { dec: '@IsString()', name: 'IsString' }
  }
}

export const tsClassValidator: GenFn = (tables): GeneratedFile[] => {
  const used = new Set<string>()
  const classes = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => {
          const { dec, name } = validatorDecorator(c)
          used.add(name)
          const lines: string[] = []
          if (c.nullable) {
            used.add('IsOptional')
            lines.push('  @IsOptional()')
          }
          lines.push(`  ${dec}`)
          lines.push(`  ${camel(c.name)}${c.nullable ? '?' : ''}: ${tsType(c.kind)}`)
          return lines.join('\n')
        })
        .join('\n\n')
      return `export class Create${modelName(t.name)}Dto {\n${rows}\n}`
    })
    .join('\n\n')
  const imports = `import { ${[...used].sort().join(', ')} } from 'class-validator'\n\n`
  return [{ filename: 'dto.ts', lang: 'ts', content: imports + classes + '\n' }]
}

// ---- Valibot ----------------------------------------------------------------

function valibotExpr(c: IRColumn): string {
  let e: string
  switch (c.kind) {
    case 'string':
    case 'text':
      e = 'v.string()'
      break
    case 'uuid':
      e = 'v.pipe(v.string(), v.uuid())'
      break
    case 'int':
      e = 'v.pipe(v.number(), v.integer())'
      break
    case 'bigint':
      e = 'v.bigint()'
      break
    case 'float':
    case 'decimal':
      e = 'v.number()'
      break
    case 'bool':
      e = 'v.boolean()'
      break
    case 'date':
    case 'datetime':
      e = 'v.date()'
      break
    case 'json':
      e = 'v.record(v.string(), v.unknown())'
      break
    case 'bytes':
      e = 'v.instance(Uint8Array)'
      break
    default:
      e = 'v.string()'
  }
  return c.nullable ? `v.nullable(${e})` : e
}

export const tsValibot: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const name = modelName(t.name)
      const rows = t.columns.map((c) => `  ${c.name}: ${valibotExpr(c)}`).join(',\n')
      return `export const ${camel(name)}Schema = v.object({\n${rows}\n})\n\nexport type ${name} = v.InferOutput<typeof ${camel(name)}Schema>`
    })
    .join('\n\n')
  return [{ filename: 'schemas.ts', lang: 'ts', content: `import * as v from 'valibot'\n\n${body}\n` }]
}
