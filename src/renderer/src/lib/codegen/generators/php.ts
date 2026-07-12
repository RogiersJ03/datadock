import type { IRColumn, IRTable, ScalarKind } from '../ir'
import type { GenFn, GeneratedFile } from '../types'
import { modelName, camel } from '../ir'
import { createTableSql, dialectOf } from './sql'

// ---- Laravel (Eloquent model + migration) -----------------------------------

function eloquentCast(c: IRColumn): string | null {
  switch (c.kind) {
    case 'bool':
      return 'boolean'
    case 'int':
    case 'bigint':
      return 'integer'
    case 'float':
      return 'float'
    case 'decimal':
      return `decimal:${c.scale ?? 2}`
    case 'json':
      return 'array'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    default:
      return null
  }
}

function laravelModel(t: IRTable): string {
  const cls = modelName(t.name)
  const fillable = t.columns
    .filter((c) => !c.isPrimaryKey && !['created_at', 'updated_at'].includes(c.name))
    .map((c) => `'${c.name}'`)
  const casts = t.columns
    .map((c) => {
      const cast = eloquentCast(c)
      return cast ? `        '${c.name}' => '${cast}',` : null
    })
    .filter(Boolean)
    .join('\n')
  const relations = t.columns
    .filter((c) => c.ref)
    .map((c) => {
      const rel = modelName(c.ref!.table)
      const method = c.name.replace(/_id$/, '') || rel.toLowerCase()
      return `\n    public function ${method}()\n    {\n        return $this->belongsTo(${rel}::class, '${c.name}', '${c.ref!.column}');\n    }`
    })
    .join('\n')
  const pk = t.primaryKey[0] ?? 'id'
  const pkOverride = pk !== 'id' ? `\n    protected $primaryKey = '${pk}';` : ''
  return `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class ${cls} extends Model
{
    protected $table = '${t.name}';${pkOverride}
    public $timestamps = ${t.hasTimestamps ? 'true' : 'false'};

    protected $fillable = [${fillable.join(', ')}];

    protected $casts = [
${casts}
    ];
${relations}
}
`
}

function blueprintCall(c: IRColumn): string {
  const n = `'${c.name}'`
  switch (c.kind) {
    case 'string':
      return c.length ? `$table->string(${n}, ${c.length})` : `$table->string(${n})`
    case 'text':
      return `$table->text(${n})`
    case 'uuid':
      return `$table->uuid(${n})`
    case 'int':
      return `$table->integer(${n})`
    case 'bigint':
      return `$table->bigInteger(${n})`
    case 'float':
      return `$table->float(${n})`
    case 'decimal':
      return `$table->decimal(${n}, ${c.precision ?? 18}, ${c.scale ?? 2})`
    case 'bool':
      return `$table->boolean(${n})`
    case 'date':
      return `$table->date(${n})`
    case 'datetime':
      return `$table->dateTime(${n})`
    case 'time':
      return `$table->time(${n})`
    case 'json':
      return `$table->json(${n})`
    case 'bytes':
      return `$table->binary(${n})`
    default:
      return `$table->string(${n})`
  }
}

function laravelMigration(t: IRTable): string {
  const rows: string[] = []
  for (const c of t.columns) {
    if (['created_at', 'updated_at'].includes(c.name)) continue
    if (c.autoIncrement && c.isPrimaryKey) {
      rows.push(c.kind === 'bigint' ? `            $table->id('${c.name}');` : `            $table->increments('${c.name}');`)
      continue
    }
    let line = `            ${blueprintCall(c)}`
    if (c.nullable) line += '->nullable()'
    if (c.unique && !c.isPrimaryKey) line += '->unique()'
    if (c.isPrimaryKey && t.primaryKey.length === 1) line += '->primary()'
    line += ';'
    rows.push(line)
    if (c.ref) {
      rows.push(
        `            $table->foreign('${c.name}')->references('${c.ref.column}')->on('${c.ref.table}');`
      )
    }
  }
  if (t.hasTimestamps) rows.push('            $table->timestamps();')
  return `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('${t.name}', function (Blueprint $table) {
${rows.join('\n')}
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('${t.name}');
    }
};
`
}

export const phpLaravel: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    for (const t of tables)
      files.push({ filename: `${modelName(t.name)}.php`, lang: 'php', content: laravelModel(t) })
  }
  if (opts.kinds.includes('migration')) {
    for (const t of tables)
      files.push({ filename: `create_${t.name}_table.php`, lang: 'php', content: laravelMigration(t) })
  }
  return files
}

// ---- Doctrine (Symfony entity + migration) ----------------------------------

function doctrineType(c: IRColumn): string {
  const map: Partial<Record<ScalarKind, string>> = {
    string: 'string',
    text: 'text',
    uuid: 'guid',
    int: 'integer',
    bigint: 'bigint',
    float: 'float',
    decimal: 'decimal',
    bool: 'boolean',
    date: 'date',
    datetime: 'datetime',
    time: 'time',
    json: 'json',
    bytes: 'blob'
  }
  return map[c.kind] ?? 'string'
}

function phpType(k: ScalarKind): string {
  switch (k) {
    case 'int':
    case 'bigint':
      return 'int'
    case 'float':
    case 'decimal':
      return 'float'
    case 'bool':
      return 'bool'
    case 'date':
    case 'datetime':
    case 'time':
      return '\\DateTimeInterface'
    case 'json':
      return 'array'
    default:
      return 'string'
  }
}

function doctrineEntity(t: IRTable): string {
  const cls = modelName(t.name)
  const props = t.columns
    .map((c) => {
      const attrs: string[] = []
      if (c.isPrimaryKey) {
        attrs.push('    #[ORM\\Id]')
        if (c.autoIncrement) attrs.push('    #[ORM\\GeneratedValue]')
      }
      const colArgs = [`type: '${doctrineType(c)}'`]
      if (c.length && c.kind === 'string') colArgs.push(`length: ${c.length}`)
      if (c.nullable) colArgs.push('nullable: true')
      if (c.unique && !c.isPrimaryKey) colArgs.push('unique: true')
      attrs.push(`    #[ORM\\Column(${colArgs.join(', ')})]`)
      const ty = (c.nullable ? '?' : '') + phpType(c.kind)
      return `${attrs.join('\n')}\n    private ${ty} $${c.name};`
    })
    .join('\n\n')
  return `<?php

namespace App\\Entity;

use Doctrine\\ORM\\Mapping as ORM;

#[ORM\\Entity]
#[ORM\\Table(name: '${t.name}')]
class ${cls}
{
${props}
}
`
}

export const phpDoctrine: GenFn = (tables, opts): GeneratedFile[] => {
  const files: GeneratedFile[] = []
  if (opts.kinds.includes('model')) {
    for (const t of tables)
      files.push({ filename: `${modelName(t.name)}.php`, lang: 'php', content: doctrineEntity(t) })
  }
  if (opts.kinds.includes('migration')) {
    const d = dialectOf(opts.driver)
    const up = tables
      .map((t) => `        $this->addSql('${createTableSql(t, d).replace(/\n\s*/g, ' ').replace(/'/g, "\\'")}');`)
      .join('\n')
    const down = [...tables]
      .reverse()
      .map((t) => `        $this->addSql('DROP TABLE ${t.name}');`)
      .join('\n')
    const ver = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    files.push({
      filename: `Version${ver}.php`,
      lang: 'php',
      content: `<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\\DBAL\\Schema\\Schema;
use Doctrine\\Migrations\\AbstractMigration;

final class Version${ver} extends AbstractMigration
{
    public function up(Schema $schema): void
    {
${up}
    }

    public function down(Schema $schema): void
    {
${down}
    }
}
`
    })
  }
  return files
}

// ---- Plain DTO (readonly promoted constructor, PHP 8.1+) --------------------

export const phpDto: GenFn = (tables): GeneratedFile[] => {
  return tables.map((t) => {
    // PHP forbids a required parameter after an optional one, so non-nullable
    // columns (no default) must come before nullable ones (which default null).
    const ordered = [...t.columns].sort((a, b) => Number(a.nullable) - Number(b.nullable))
    const params = ordered
      .map((c) => {
        const ty = (c.nullable ? '?' : '') + phpType(c.kind)
        const def = c.nullable ? ' = null' : ''
        return `        public readonly ${ty} $${camel(c.name)}${def},`
      })
      .join('\n')
    const content = `<?php

namespace App\\DTO;

final class ${modelName(t.name)}DTO
{
    public function __construct(
${params}
    ) {}
}
`
    return { filename: `${modelName(t.name)}DTO.php`, lang: 'php', content }
  })
}
