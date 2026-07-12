import type { IRColumn, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, snake, pascal } from '../ir'

function ectoType(k: ScalarKind): string {
  switch (k) {
    case 'string':
      return ':string'
    case 'text':
      return ':string'
    case 'uuid':
      return 'Ecto.UUID'
    case 'int':
      return ':integer'
    case 'bigint':
      return ':integer'
    case 'float':
      return ':float'
    case 'decimal':
      return ':decimal'
    case 'bool':
      return ':boolean'
    case 'date':
      return ':date'
    case 'datetime':
      return ':naive_datetime'
    case 'time':
      return ':time'
    case 'json':
      return ':map'
    case 'bytes':
      return ':binary'
    default:
      return ':string'
  }
}

const TS_COLS = ['inserted_at', 'updated_at', 'created_at']

// ---- Ecto schema + migration ------------------------------------------------

export const elixirEcto: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []

  if (opts.kinds.includes('model')) {
    for (const t of tables) {
      const fields = t.columns
        .filter((c) => !(c.isPrimaryKey && c.autoIncrement && c.name === 'id') && !TS_COLS.includes(c.name))
        .map((c) => {
          if (c.ref)
            return `    belongs_to :${snake(c.ref.table).replace(/s$/, '')}, App.${modelName(c.ref.table)}, foreign_key: :${snake(c.name)}`
          return `    field :${snake(c.name)}, ${ectoType(c.kind)}`
        })
        .join('\n')
      const ts = t.hasTimestamps ? '\n\n    timestamps()' : ''
      files.push({
        filename: `${snake(modelName(t.name))}.ex`,
        lang: 'elixir',
        content: `defmodule App.${modelName(t.name)} do
  use Ecto.Schema
  import Ecto.Changeset

  schema "${t.name}" do
${fields}${ts}
  end
end
`
      })
    }
  }

  if (opts.kinds.includes('migration')) {
    for (const t of tables) {
      const adds = t.columns
        .filter((c) => !(c.isPrimaryKey && c.autoIncrement && c.name === 'id') && !TS_COLS.includes(c.name))
        .map((c) => {
          const nullOpt = c.nullable ? '' : ', null: false'
          if (c.ref)
            return `      add :${snake(c.name)}, references(:${snake(c.ref.table)}, column: :${snake(c.ref.column)}, type: :${c.kind === 'bigint' ? 'bigint' : 'integer'})${nullOpt}`
          return `      add :${snake(c.name)}, ${ectoType(c.kind)}${nullOpt}`
        })
        .join('\n')
      const ts = t.hasTimestamps ? '\n\n      timestamps()' : ''
      files.push({
        filename: `create_${snake(t.name)}.exs`,
        lang: 'elixir',
        content: `defmodule App.Repo.Migrations.Create${pascal(t.name)} do
  use Ecto.Migration

  def change do
    create table(:${t.name}) do
${adds}${ts}
    end
  end
end
`
      })
    }
  }

  return files
}
