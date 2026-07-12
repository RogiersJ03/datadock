import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, snake } from '../ir'

// chrono / rust_decimal / uuid / serde_json based type mapping.
function rustType(c: IRColumn): string {
  let base: string
  switch (c.kind) {
    case 'string':
    case 'text':
      base = 'String'
      break
    case 'uuid':
      base = 'Uuid'
      break
    case 'int':
      base = 'i32'
      break
    case 'bigint':
      base = 'i64'
      break
    case 'float':
      base = 'f64'
      break
    case 'decimal':
      base = 'Decimal'
      break
    case 'bool':
      base = 'bool'
      break
    case 'date':
      base = 'NaiveDate'
      break
    case 'datetime':
      base = 'NaiveDateTime'
      break
    case 'time':
      base = 'NaiveTime'
      break
    case 'json':
      base = 'serde_json::Value'
      break
    case 'bytes':
      base = 'Vec<u8>'
      break
    default:
      base = 'String'
  }
  return c.nullable ? `Option<${base}>` : base
}

function rustUses(cols: IRColumn[]): string {
  const u: string[] = []
  if (cols.some((c) => ['date', 'datetime', 'time'].includes(c.kind)))
    u.push('use chrono::{NaiveDate, NaiveDateTime, NaiveTime};')
  if (cols.some((c) => c.kind === 'decimal')) u.push('use rust_decimal::Decimal;')
  if (cols.some((c) => c.kind === 'uuid')) u.push('use uuid::Uuid;')
  return u.length ? u.join('\n') + '\n' : ''
}

// ---- sqlx (serde struct) ----------------------------------------------------

export const rustSqlx: GenFn = (tables): GeneratedFile[] => {
  const all = tables.flatMap((t) => t.columns)
  const body = tables
    .map((t) => {
      const rows = t.columns.map((c) => `    pub ${snake(c.name)}: ${rustType(c)},`).join('\n')
      return `#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]\npub struct ${modelName(t.name)} {\n${rows}\n}`
    })
    .join('\n\n')
  return [{ filename: 'models.rs', lang: 'rust', content: rustUses(all) + '\n' + body + '\n' }]
}

// ---- SeaORM entity ----------------------------------------------------------

export const rustSeaorm: GenFn = (tables): GeneratedFile[] => {
  return tables.map((t) => {
    const rows = t.columns
      .map((c) => {
        const attrs: string[] = []
        if (c.isPrimaryKey) attrs.push(c.autoIncrement ? 'primary_key' : 'primary_key, auto_increment = false')
        if (c.unique && !c.isPrimaryKey) attrs.push('unique')
        const attr = attrs.length ? `    #[sea_orm(${attrs.join(', ')})]\n` : ''
        return `${attr}    pub ${snake(c.name)}: ${rustType(c)},`
      })
      .join('\n')
    const content = `use sea_orm::entity::prelude::*;
${rustUses(t.columns)}
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "${t.name}")]
pub struct Model {
${rows}
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
`
    return { filename: `${snake(modelName(t.name))}.rs`, lang: 'rust', content }
  })
}

// ---- Diesel table! macro ----------------------------------------------------

function dieselType(c: IRColumn): string {
  const map: Partial<Record<ScalarKind, string>> = {
    string: 'Varchar',
    text: 'Text',
    uuid: 'Uuid',
    int: 'Int4',
    bigint: 'Int8',
    float: 'Float8',
    decimal: 'Numeric',
    bool: 'Bool',
    date: 'Date',
    datetime: 'Timestamp',
    time: 'Time',
    json: 'Jsonb',
    bytes: 'Bytea'
  }
  const base = map[c.kind] ?? 'Text'
  return c.nullable ? `Nullable<${base}>` : base
}

export const rustDiesel: GenFn = (tables): GeneratedFile[] => {
  const body = tables
    .map((t) => {
      const pk = t.primaryKey.length ? t.primaryKey.map(snake).join(', ') : 'id'
      const rows = t.columns.map((c) => `        ${snake(c.name)} -> ${dieselType(c)},`).join('\n')
      return `diesel::table! {\n    ${snake(t.name)} (${pk}) {\n${rows}\n    }\n}`
    })
    .join('\n\n')
  return [{ filename: 'schema.rs', lang: 'rust', content: body + '\n' }]
}
