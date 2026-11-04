export const SAMPLE_SCHEMA = "dbtuna_sample";
const integer = (name, nullable = false) => ({ name, type: "int", nullable });
const text = (name, length) => ({
  name,
  type: "text",
  length,
  nullable: false,
});
const date = (name) => ({ name, type: "date", nullable: false });
const fk = (name, column, table, target) => ({
  name,
  columns: [column],
  table,
  targets: [target],
});
const unique = (name, ...columns) => ({ name, columns });
const day = (index) =>
  new Date(Date.UTC(2024, 0, 1 + (index % 366))).toISOString().slice(0, 10);
const rows = (count, row) =>
  Array.from({ length: count }, (_, index) => row(index + 1));
const label = (id) => String(id).padStart(3, "0");
export const SAMPLE_TABLES = [
  {
    name: "owners",
    columns: [
      integer("owner_id"),
      text("owner_name", 80),
      text("email", 100),
      integer("manager_id", true),
    ],
    primaryKey: ["owner_id"],
    foreignKeys: [fk("fk_owners_manager", "manager_id", "owners", "owner_id")],
    uniqueKeys: [unique("uq_owners_email", "email")],
    rows: rows(100, (id) => [
      id,
      id === 7 ? "Alex O'Connell" : `Owner ${label(id)}`,
      `owner${label(id)}@example.test`,
      id === 1 ? null : Math.floor(id / 2),
    ]),
  },
  {
    name: "data_systems",
    columns: [
      integer("system_id"),
      text("system_name", 80),
      text("system_type", 20),
      integer("owner_id"),
    ],
    primaryKey: ["system_id"],
    foreignKeys: [fk("fk_systems_owner", "owner_id", "owners", "owner_id")],
    uniqueKeys: [unique("uq_systems_name", "system_name")],
    rows: rows(100, (id) => [
      id,
      `System ${label(id)}`,
      ["PostgreSQL", "SQL Server", "Oracle"][(id - 1) % 3],
      ((id * 7) % 100) + 1,
    ]),
  },
  {
    name: "data_schemas",
    columns: [
      integer("schema_id"),
      integer("system_id"),
      text("schema_name", 80),
      integer("owner_id"),
    ],
    primaryKey: ["schema_id"],
    foreignKeys: [
      fk("fk_schemas_system", "system_id", "data_systems", "system_id"),
      fk("fk_schemas_owner", "owner_id", "owners", "owner_id"),
    ],
    uniqueKeys: [unique("uq_schemas_name", "system_id", "schema_name")],
    rows: rows(120, (id) => [
      id,
      ((id - 1) % 100) + 1,
      `schema_${label(id)}`,
      ((id * 11) % 100) + 1,
    ]),
  },
  {
    name: "data_tables",
    columns: [
      integer("table_id"),
      integer("schema_id"),
      text("table_name", 80),
      integer("owner_id"),
      text("description", 160),
      date("created_on"),
    ],
    primaryKey: ["table_id"],
    foreignKeys: [
      fk("fk_tables_schema", "schema_id", "data_schemas", "schema_id"),
      fk("fk_tables_owner", "owner_id", "owners", "owner_id"),
    ],
    uniqueKeys: [unique("uq_tables_name", "schema_id", "table_name")],
    rows: rows(150, (id) => [
      id,
      ((id - 1) % 120) + 1,
      `asset_${label(id)}`,
      ((id * 13) % 100) + 1,
      `Demonstration metadata asset ${label(id)}`,
      day(id),
    ]),
  },
  {
    name: "data_columns",
    columns: [
      integer("column_id"),
      integer("table_id"),
      text("column_name", 80),
      text("data_type", 30),
      integer("ordinal_position"),
      integer("is_nullable"),
    ],
    primaryKey: ["column_id"],
    foreignKeys: [
      fk("fk_columns_table", "table_id", "data_tables", "table_id"),
    ],
    uniqueKeys: [
      unique("uq_columns_position", "table_id", "ordinal_position"),
      unique("uq_columns_name", "table_id", "column_name"),
    ],
    checks: [{ name: "ck_columns_nullable", sql: "is_nullable IN (0, 1)" }],
    rows: rows(250, (id) => [
      id,
      ((id - 1) % 150) + 1,
      `column_${String(Math.floor((id - 1) / 150) + 1).padStart(2, "0")}`,
      ["INTEGER", "VARCHAR(100)", "DATE", "DECIMAL(10,2)"][(id - 1) % 4],
      Math.floor((id - 1) / 150) + 1,
      id % 2,
    ]),
  },
  {
    name: "classifications",
    columns: [
      integer("classification_id"),
      text("classification_name", 80),
      integer("sensitivity_level"),
      text("description", 160),
    ],
    primaryKey: ["classification_id"],
    foreignKeys: [],
    uniqueKeys: [unique("uq_classifications_name", "classification_name")],
    checks: [
      {
        name: "ck_classifications_level",
        sql: "sensitivity_level BETWEEN 0 AND 4",
      },
    ],
    rows: rows(100, (id) => [
      id,
      `Classification ${label(id)}`,
      (id - 1) % 5,
      `Classification policy ${label(id)}`,
    ]),
  },
  {
    name: "tags",
    columns: [
      integer("tag_id"),
      text("tag_name", 60),
      text("description", 160),
    ],
    primaryKey: ["tag_id"],
    foreignKeys: [],
    uniqueKeys: [unique("uq_tags_name", "tag_name")],
    rows: rows(100, (id) => [
      id,
      `tag_${label(id)}`,
      `Metadata tag ${label(id)}`,
    ]),
  },
  {
    name: "table_tags",
    columns: [
      integer("table_id"),
      integer("tag_id"),
      integer("assigned_by"),
      date("assigned_on"),
    ],
    primaryKey: ["table_id", "tag_id"],
    foreignKeys: [
      fk("fk_table_tags_table", "table_id", "data_tables", "table_id"),
      fk("fk_table_tags_tag", "tag_id", "tags", "tag_id"),
      fk("fk_table_tags_owner", "assigned_by", "owners", "owner_id"),
    ],
    uniqueKeys: [],
    rows: rows(200, (id) => [
      ((id - 1) % 150) + 1,
      ((id - 1) % 100) + 1,
      ((id * 17) % 100) + 1,
      day(id + 10),
    ]),
  },
  {
    name: "column_classifications",
    columns: [
      integer("column_id"),
      integer("classification_id"),
      integer("assigned_by"),
      integer("confidence_score"),
    ],
    primaryKey: ["column_id", "classification_id"],
    foreignKeys: [
      fk("fk_col_class_column", "column_id", "data_columns", "column_id"),
      fk(
        "fk_col_class_policy",
        "classification_id",
        "classifications",
        "classification_id",
      ),
      fk("fk_col_class_owner", "assigned_by", "owners", "owner_id"),
    ],
    uniqueKeys: [],
    checks: [
      {
        name: "ck_col_class_confidence",
        sql: "confidence_score BETWEEN 0 AND 100",
      },
    ],
    rows: rows(200, (id) => [
      id,
      ((id - 1) % 100) + 1,
      ((id * 19) % 100) + 1,
      70 + (id % 31),
    ]),
  },
  {
    name: "data_lineage",
    columns: [
      integer("lineage_id"),
      integer("source_table_id"),
      integer("target_table_id"),
      text("transformation", 160),
    ],
    primaryKey: ["lineage_id"],
    foreignKeys: [
      fk("fk_lineage_source", "source_table_id", "data_tables", "table_id"),
      fk("fk_lineage_target", "target_table_id", "data_tables", "table_id"),
    ],
    uniqueKeys: [
      unique("uq_lineage_pair", "source_table_id", "target_table_id"),
    ],
    checks: [
      {
        name: "ck_lineage_not_self",
        sql: "source_table_id <> target_table_id",
      },
    ],
    rows: rows(200, (id) => [
      id,
      ((id - 1) % 150) + 1,
      ((((id - 1) % 150) + 1 + Math.floor((id - 1) / 150) * 7) % 150) + 1,
      `Transform metadata flow ${label(id)}`,
    ]),
  },
];
export function identifier(engine, name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw Error("Invalid fixed sample identifier.");
  return engine === "oracle"
    ? name.toUpperCase()
    : engine === "sqlserver"
      ? `[${name}]`
      : `"${name}"`;
}
export const qualified = (engine, name) =>
  `${identifier(engine, SAMPLE_SCHEMA)}.${identifier(engine, name)}`;
export function tableDDL(engine, table) {
  const id = (name) => identifier(engine, name);
  const fields = table.columns.map((column) => {
    const type =
      column.type === "int"
        ? engine === "oracle"
          ? "NUMBER(10,0)"
          : "INTEGER"
        : column.type === "date"
          ? "DATE"
          : engine === "oracle"
            ? `VARCHAR2(${column.length} CHAR)`
            : engine === "sqlserver"
              ? `NVARCHAR(${column.length})`
              : `VARCHAR(${column.length})`;
    return `${id(column.name)} ${type}${column.nullable ? "" : " NOT NULL"}`;
  });
  fields.push(
    `CONSTRAINT ${id(`pk_${table.name}`)} PRIMARY KEY (${table.primaryKey.map(id).join(", ")})`,
  );
  for (const key of table.uniqueKeys)
    fields.push(
      `CONSTRAINT ${id(key.name)} UNIQUE (${key.columns.map(id).join(", ")})`,
    );
  for (const key of table.foreignKeys)
    fields.push(
      `CONSTRAINT ${id(key.name)} FOREIGN KEY (${key.columns.map(id).join(", ")}) REFERENCES ${qualified(engine, key.table)} (${key.targets.map(id).join(", ")})`,
    );
  for (const check of table.checks ?? [])
    fields.push(`CONSTRAINT ${id(check.name)} CHECK (${check.sql})`);
  return `CREATE TABLE ${qualified(engine, table.name)} (${fields.join(", ")})`;
}
function literal(engine, value, column) {
  if (value === null) return "NULL";
  if (column.type === "int") {
    if (!Number.isSafeInteger(value)) throw Error("Invalid sample integer.");
    return String(value);
  }
  if (column.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Invalid sample date.");
  const escaped = String(value).replaceAll("'", "''");
  if (column.type === "date")
    return engine === "sqlserver"
      ? `CONVERT(date,'${escaped}',23)`
      : `DATE '${escaped}'`;
  return `${engine === "sqlserver" ? "N" : ""}'${escaped}'`;
}
export function tableInserts(engine, table) {
  const columns = table.columns
    .map((column) => identifier(engine, column.name))
    .join(", ");
  const values = (row) =>
    `(${row.map((value, index) => literal(engine, value, table.columns[index])).join(", ")})`;
  if (engine === "oracle")
    return table.rows.map(
      (row) =>
        `INSERT INTO ${qualified(engine, table.name)} (${columns}) VALUES ${values(row)}`,
    );
  const result = [];
  for (let i = 0; i < table.rows.length; i += 100)
    result.push(
      `INSERT INTO ${qualified(engine, table.name)} (${columns}) VALUES ${table.rows
        .slice(i, i + 100)
        .map(values)
        .join(", ")}`,
    );
  return result;
}
export function tableSelect(engine, table) {
  const columns = table.columns.map((column) => {
    const name = identifier(engine, column.name);
    if (column.type !== "date") return name;
    return engine === "sqlserver"
      ? `CONVERT(char(10), ${name}, 23)`
      : `TO_CHAR(${name}, 'YYYY-MM-DD')`;
  });
  return `SELECT ${columns.join(", ")} FROM ${qualified(engine, table.name)} ORDER BY ${table.primaryKey.map((name) => identifier(engine, name)).join(", ")}`;
}
export function canonicalRows(table) {
  const positions = table.primaryKey.map((name) =>
    table.columns.findIndex((column) => column.name === name),
  );
  return [...table.rows].sort((a, b) => {
    for (const index of positions)
      if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  });
}
