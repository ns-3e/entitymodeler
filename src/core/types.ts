// EntityModel.com model (model.json) — the canonical design file.
// Entities, relationships and hierarchies are keyed by their internal `name`, never by numeric id.

export const FORMAT = 'entitymodeler' as const;
export const FORMAT_VERSION = 1;
/** Written into every model file (like Excalidraw's "source"), so shared files point back to the app. */
export const SOURCE_URL = 'https://entitymodel.com';

export const SCALAR_TYPES = [
  'STRING',
  'BIGINT',
  'INT',
  'SMALLINT',
  'TINYINT',
  'DOUBLE',
  'DECIMAL',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];
export type AttrType = ScalarType | 'STRUCT' | 'REFERENCE_ENTITY';
export const ATTR_TYPES: AttrType[] = [...SCALAR_TYPES, 'STRUCT', 'REFERENCE_ENTITY'];

export type EntityType = 'standard' | 'reference';
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

/** REFERENCE_ENTITY target: which reference entity, and which of its attributes is stored on the referencing record. */
export interface ReferenceConfig {
  entity: string;
  output_attribute: string;
}

export interface Attribute {
  name: string;
  label: string;
  type: AttrType;
  description?: string;
  is_array?: boolean;
  is_primary_key?: boolean;
  /** Values are unique across rows (besides the primary key): a UNIQUE constraint and a dbt unique test. */
  unique?: boolean;
  /** DECIMAL only: total digits and digits after the point (default 18, 2). */
  precision?: number;
  scale?: number;
  /** Primary display field. */
  is_label?: boolean;
  reference?: ReferenceConfig;
  /** Name of a struct type on the same entity, when type is STRUCT. */
  struct_type?: string;
  // Documentation metadata
  required?: boolean;
  pii?: boolean;
  example?: string;
  notes?: string;
  /** Name of the attribute this one was derived from, in the source tab's entity (set by tab derivation). */
  derived_from?: string;
  /** Business glossary term id (see glossary_snapshot). */
  term?: string;
  /** What the data looks like, measured by `em profile` (never sample values, only counts and ranges). */
  profile?: AttributeProfile;
}

/** Column statistics from data profiling. `rows` on the entity's profile is the denominator. */
export interface AttributeProfile {
  /** Rows where the column has a value. */
  non_null: number;
  /** Distinct values (approximate on Databricks and Snowflake). Absent for types that can't be compared. */
  distinct?: number;
  /** Smallest and largest value, for numbers and dates only (strings could be personal data). */
  min?: string;
  max?: string;
  /** Longest value in characters, for strings. */
  max_length?: number;
}

/** Table-level result of data profiling. */
export interface EntityProfile {
  rows: number;
  /** True when profiling stopped at the row limit, so counts describe a sample. */
  sampled?: boolean;
  /** True when distinct counts are estimates (a full-table scan on Databricks or Snowflake). */
  approx_distinct?: boolean;
  profiled_at: string;
}

export interface StructField {
  name: string;
  label?: string;
  type: ScalarType | 'REFERENCE_ENTITY';
  description?: string;
  reference?: ReferenceConfig;
}

export interface StructType {
  name: string;
  description?: string;
  fields: StructField[];
}

export interface DependentReference {
  /** Parent reference entity name. */
  parent: string;
  /** Parent attribute that child records carry (defaults to the parent PK). */
  linked_column: string;
}

/** One row of a reference list, keyed by attribute name (plus the dependent-reference linked column). */
export type ReferenceValue = Record<string, string>;

export interface Position {
  x: number;
  y: number;
}

export interface Entity {
  name: string;
  display_name: string;
  entity_type: EntityType;
  description?: string;
  color_code: string;
  /** Subject area / domain grouping (design only). */
  area?: string;
  attributes: Attribute[];
  struct_types?: StructType[];
  dependent_reference?: DependentReference | null;
  /** Reference entities: the list's values (seed data / documentation). */
  reference_values?: ReferenceValue[];
  /** Where the values came from, e.g. "ISO 3166-1, codes workbook v1.1". */
  reference_values_source?: string;
  notes?: string;
  /** Name of the entity this one was derived from, in the tab named by the tab's `derived_from`. */
  derived_from?: string;
  /** Business glossary term id (see glossary_snapshot). */
  term?: string;
  /** Data profiling result for the table (see Attribute.profile). */
  profile?: EntityProfile;
  /** Canvas state for this tab. `hidden` keeps the entity in the model but off the diagram. */
  /** Diagram layout. `folded` lists STRUCT attributes whose fields are collapsed into one row. */
  ui?: Position & { collapsed?: boolean; hidden?: boolean; folded?: string[] };
}

export interface Relationship {
  name: string;
  source: string;
  target: string;
  cardinality: Cardinality;
  forward_label: string;
  reverse_label?: string;
  bidirectional: boolean;
  description?: string;
  /**
   * Attribute on the child side that holds the parent's key (used for SQL/DBML). The child is the source
   * for N:1 and 1:1, the target for 1:N; N:N has none (a junction table is generated). Unset = inferred.
   */
  foreign_key?: string;
  attributes?: Attribute[];
}

export interface HierarchyBranch {
  name: string;
  entity: string;
  relationship: string;
  direction: 'forward' | 'reverse';
  parent_branch: string;
}

export interface HierarchyLevel {
  level: number;
  branches: HierarchyBranch[];
}

export interface Hierarchy {
  name: string;
  display_name: string;
  description?: string;
  root: string;
  root_branch_name?: string;
  status: 'draft' | 'active' | 'retired';
  max_depth?: number | null;
  allow_multi_parent?: boolean;
  levels: HierarchyLevel[];
}

export interface Area {
  id: string;
  name: string;
  color: string;
  description?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Note {
  id: string;
  text: string;
  color?: string;
  x: number;
  y: number;
  w?: number;
}

/** What a diagram tab models. Conceptual tabs carry entities and relationships without attribute rules. */
export type TabKind = 'conceptual' | 'logical' | 'physical' | 'variant';
export const TAB_KINDS: { id: TabKind; label: string; hint: string }[] = [
  { id: 'conceptual', label: 'Conceptual', hint: 'Business entities and how they relate, no attributes required' },
  { id: 'logical', label: 'Logical', hint: 'Business names, attributes and keys; relationships instead of foreign-key columns' },
  { id: 'physical', label: 'Physical', hint: 'Tables and columns for one platform: foreign-key columns, junction tables' },
  { id: 'variant', label: 'Variant', hint: 'An alternative design or version of another tab' },
];

/** The content one diagram tab holds. The model's top level is the primary tab. */
export interface ModelContent {
  entities: Entity[];
  relationships: Relationship[];
  hierarchies: Hierarchy[];
  areas: Area[];
  notes: Note[];
}

export interface TabMeta {
  name: string;
  kind: TabKind;
  description?: string;
  /** Physical tabs: the target platform (default SQL dialect). */
  dialect?: 'postgres' | 'mysql' | 'snowflake' | 'databricks';
  /** Id of the tab this one was derived or copied from ("main" for the primary tab). */
  derived_from?: string;
  derived_at?: string;
  /** Tabs pulled from a live database: where from and when (`em pull`). */
  source?: {
    platform: 'databricks' | 'snowflake' | 'postgres' | 'mysql';
    catalog?: string;
    schema?: string;
    /** Databricks CLI profile it was pulled with (a name in ~/.databrickscfg, never a credential), so profiling and write-back reach the same workspace. */
    profile?: string;
    pulled_at: string;
  };
}

/** An additional diagram tab: its own entities, relationships and layout. */
export interface ModelTab extends TabMeta, ModelContent {
  id: string;
}

/** A business term from the shared glossary (models/_glossary.json locally, browser storage on the site). */
export interface GlossaryTerm {
  id: string;
  name: string;
  definition: string;
  synonyms?: string[];
  domain?: string;
  owner?: string;
  status?: 'draft' | 'approved' | 'deprecated';
  updated_at?: string;
}

/** What a review comment is about. `tab` is a tab id. */
export interface CommentTarget {
  tab: string;
  kind: 'model' | 'entity' | 'relationship';
  name?: string;
  attribute?: string;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface ReviewComment extends CommentReply {
  target: CommentTarget;
  resolved?: boolean;
  replies?: CommentReply[];
}

/** One end of a mapping: an entity (and usually an attribute) in a tab. */
export interface MappingEnd {
  tab: string;
  entity: string;
  attribute?: string;
}

/** Source-to-target mapping for one target attribute (lineage for ETL specs and dbt models). */
export interface Mapping {
  id: string;
  target: MappingEnd & { attribute: string };
  /** Zero (a constant or derived value) or more source columns. */
  sources: MappingEnd[];
  /** SQL expression or rule; empty = direct copy of the single source. */
  transform?: string;
  notes?: string;
  status?: 'draft' | 'approved';
}

/** Naming and documentation rules checked for one kind of tab. Every field is optional; unset = not checked. */
export interface NamingStandard {
  /** Attribute names. (Entity and relationship names are always lowercase snake_case.) */
  attribute_case?: 'snake' | 'camel' | 'upper_snake';
  /** Entity names end in a singular or a plural noun. */
  entity_number?: 'singular' | 'plural';
  /** Required prefix on standard entity names, e.g. "tbl_" or "dim_". */
  entity_prefix?: string;
  /** Required prefix on reference entity names, e.g. "ref_". */
  reference_prefix?: string;
  /** Primary keys of standard entities end with this, e.g. "_id". */
  pk_suffix?: string;
  /** "expand": flag known abbreviations (cust, amt, qty…) in names. */
  abbreviations?: 'expand';
  /** Longest allowed name (platform identifier limit). */
  max_length?: number;
  require_entity_description?: boolean;
  require_attribute_description?: boolean;
  /** Attributes whose name suggests personal data (email, phone, birth…) must be marked PII. */
  require_pii_review?: boolean;
}

export interface DataModel {
  format: typeof FORMAT;
  format_version: number;
  /** SOURCE_URL: where the file was made. */
  source?: string;
  name: string;
  title: string;
  organization?: string;
  description?: string;
  version?: string;
  author?: string;
  status?: 'draft' | 'in review' | 'approved';
  created_at: string;
  updated_at: string;
  entities: Entity[];
  relationships: Relationship[];
  hierarchies: Hierarchy[];
  areas: Area[];
  notes: Note[];
  /** Name and kind of the primary tab (the top-level content). Absent = "Main", logical. */
  tab?: TabMeta;
  /** Further diagram tabs (variants, versions, logical/physical views). */
  tabs?: ModelTab[];
  /** Naming standards per tab kind, checked with validation (see src/core/standards.ts). */
  standards?: Partial<Record<TabKind, NamingStandard>>;
  /** Source-to-target mappings between tabs (see src/core/mappings.ts). */
  mappings?: Mapping[];
  /** The glossary terms this model links to, embedded so the file stands alone. */
  glossary_snapshot?: GlossaryTerm[];
  /** Review comments on the model, its entities, attributes and relationships. */
  comments?: ReviewComment[];
}

/** One row of a model list (home page, CLI). */
export interface ModelSummary {
  id: string;
  title: string;
  organization?: string;
  description?: string;
  status?: string;
  version?: string;
  updated_at?: string;
  entities?: number;
  standard?: number;
  references?: number;
  relationships?: number;
  colors?: string[];
  error?: string;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
  /** What the issue is about, for navigation in the UI. */
  target: { kind: 'model' | 'entity' | 'relationship' | 'hierarchy'; name?: string; tab?: string; attribute?: string };
  code: string;
  /** Operations that resolve the issue (naming standards and other auto-fixable checks). */
  fix?: import('./operations').Op[];
  /** The fix is a judgement call (e.g. from profiled data): offer it one at a time, never in a bulk "fix all". */
  suggested?: boolean;
}
