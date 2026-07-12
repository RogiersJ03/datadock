import type { IRColumn, IRTable } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, snake, pascal } from '../ir'

// ---- ActiveRecord model -----------------------------------------------------

function arModel(t: IRTable): string {
  const cls = modelName(t.name)
  const assoc = t.columns
    .filter((c) => c.ref)
    .map((c) => `  belongs_to :${snake(c.name).replace(/_id$/, '')}`)
    .join('\n')
  const validations = t.columns
    .filter((c) => !c.nullable && !c.isPrimaryKey && !['created_at', 'updated_at'].includes(c.name) && !c.ref)
    .map((c) => `  validates :${c.name}, presence: true`)
    .join('\n')
  const parts = [assoc, validations].filter(Boolean).join('\n\n')
  return `class ${cls} < ApplicationRecord\n${parts ? parts + '\n' : ''}end\n`
}

// ---- Rails migration --------------------------------------------------------

function railsType(c: IRColumn): string {
  switch (c.kind) {
    case 'string':
    case 'uuid':
      return 'string'
    case 'text':
      return 'text'
    case 'int':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'float':
      return 'float'
    case 'decimal':
      return 'decimal'
    case 'bool':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'time':
      return 'time'
    case 'json':
      return 'json'
    case 'bytes':
      return 'binary'
    default:
      return 'string'
  }
}

function railsMigration(t: IRTable): string {
  const cls = `Create${pascal(t.name)}`
  const rows: string[] = []
  for (const c of t.columns) {
    // Rails auto-creates the `id` primary key.
    if (c.autoIncrement && c.isPrimaryKey && c.name === 'id') continue
    if (['created_at', 'updated_at'].includes(c.name)) continue
    if (c.ref) {
      const opts = c.nullable ? '' : ', null: false'
      rows.push(`      t.references :${snake(c.name).replace(/_id$/, '')}, foreign_key: { to_table: :${c.ref.table} }${opts}`)
      continue
    }
    const opts: string[] = []
    if (!c.nullable) opts.push('null: false')
    if (c.kind === 'decimal') opts.push(`precision: ${c.precision ?? 18}`, `scale: ${c.scale ?? 2}`)
    if (c.length && c.kind === 'string') opts.push(`limit: ${c.length}`)
    rows.push(`      t.${railsType(c)} :${c.name}${opts.length ? ', ' + opts.join(', ') : ''}`)
  }
  if (t.hasTimestamps) rows.push('      t.timestamps')
  const idOpt = t.primaryKey.length === 1 && t.primaryKey[0] !== 'id' ? `, primary_key: :${t.primaryKey[0]}` : ''
  return `class ${cls} < ActiveRecord::Migration[7.1]
  def change
    create_table :${t.name}${idOpt} do |t|
${rows.join('\n')}
    end
  end
end
`
}

export const rbActiveRecord: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    for (const t of tables)
      files.push({ filename: `${snake(modelName(t.name))}.rb`, lang: 'ruby', content: arModel(t) })
  }
  if (opts.kinds.includes('migration')) {
    for (const t of tables)
      files.push({ filename: `create_${t.name}.rb`, lang: 'ruby', content: railsMigration(t) })
  }
  return files
}
