// ═══════════════════════════════════════════════════
// Domain-typed extraction schemas — Memory ROADMAP.md Phase 1.
//
// Every Memory node keeps the existing generic base
// (title/content/tags/hub/family/entityName + system metadata — see
// addLearning in memory.js) regardless of hub. This file adds an
// ADDITIONAL, per-hub-typed structured object on top of that base — never
// a replacement. Phase 1 covers exactly one hub: "defects". Every other
// hub falls back to the generic shape via getSchemaForHub returning null.
//
// No TypeScript in this project — plain JS with hand-rolled runtime
// validation, matching every other service in this codebase (no schema
// validation library exists here today, and one hub's worth of fields
// doesn't justify introducing one).
// ═══════════════════════════════════════════════════

// ── Family taxonomy — fixed sub-categories per hub ──────────────────────
// Mirrors how hub itself is a fixed enum (FIXED_HUBS), not free text: before
// this, `family` was independently LLM-generated prose per extraction call
// ("Epoxy" vs "epoxy resins" vs "Epoxy resin" for the same thing), which
// fragmented the Knowledge Graph canvas's family-ring grouping instead of
// clustering it. Every list ends in "Other" deliberately — a forced-choice
// taxonomy with no escape valve mangles genuine outliers into the nearest
// wrong bucket. List lengths aren't uniform on purpose: "resins" is
// genuinely the most chemically diverse hub in this domain, "patents"
// genuinely isn't.
//
// "defects" is a special case: its family is NEVER asked of the model
// directly — it's derived from defectSchema.defect_type (DEFECT_TYPE_TO_FAMILY
// below), so a defect node's category is classified exactly once and reused
// in both places, not asked twice with a chance of disagreeing. Its entry
// here exists only so the taxonomy endpoint/UI (e.g. the Knowledge Graph
// Management edit dropdown) has a display list for that hub too.
//
// "competitor" and "general"/custom hubs deliberately have no taxonomy:
// competitor nodes are already keyed by entityName (the company) and don't
// need sub-categorization; "general"/custom hubs are open-ended by
// definition, so a fixed list would contradict their purpose.
export const FAMILY_TAXONOMY = {
  resins: ["Acrylic", "Epoxy", "Polyurethane", "Polyester", "Alkyd", "Vinyl", "Silicone", "Fluoropolymer", "Specialty/High-performance", "Other"],
  crosslinkers: ["Isocyanate", "Amine", "Melamine/Amino resin", "Anhydride", "Silane", "Aziridine", "Catalyst/Accelerator", "Other"],
  additives: ["Rheology modifier", "Wetting/Dispersing agent", "Defoamer", "Filler/Extender", "Adhesion promoter/Coupling agent", "UV/Light stabilizer", "Flow/Leveling agent", "Biocide/Preservative", "Other"],
  pigments: ["White pigment", "Black pigment", "Inorganic color pigment", "Organic color pigment", "Effect pigment", "Extender/Filler pigment", "Other"],
  formulations: ["Solvent-based systems", "Waterborne systems", "UV-curable systems", "Powder coatings", "2K stoichiometry & ratios", "Failed attempts/Troubleshooting", "Other"],
  processes: ["Application method", "Drying", "Curing", "Surface treatment/Pretreatment", "Mixing/Dispersion", "Lamination/B-staging", "Other"],
  equipment: ["Dispersion/Mixing equipment", "Coating/Application line", "Drying/Curing equipment", "Lab-scale/Pilot equipment", "Measurement/QC instruments", "Other"],
  defects: ["Adhesion failure", "Surface defect", "Color deviation", "Cure defect", "Shrinkage", "Contamination", "Incompatibility", "Degradation", "Other"],
  regulations: ["REACH/SVHC", "CLP/GHS", "VOC regulations", "RoHS", "Food contact/Medical compliance", "Occupational exposure", "Other"],
  patents: ["Freedom-to-operate (FTO)", "Prior art/Literature search", "Claim analysis", "Competitor patent landscape", "Other"],
};

// The exact coupling: a defect node's family is derived from
// defectSchema.defect_type, never asked of the model as a separate field.
// Keys mirror the defect_type values already used verbatim across every
// extraction prompt (expertInterview.js, ai.js, sourceRunner.js).
export const DEFECT_TYPE_TO_FAMILY = {
  contamination: "Contamination",
  incompatibility: "Incompatibility",
  degradation: "Degradation",
  color_deviation: "Color deviation",
  adhesion_failure: "Adhesion failure",
  cure_defect: "Cure defect",
  surface_defect: "Surface defect",
  shrinkage: "Shrinkage",
};
export function familyForDefectType(defectType) {
  return DEFECT_TYPE_TO_FAMILY[defectType] || "Other";
}

// Renders the taxonomy as prompt text — reused verbatim by all five
// extraction prompts (chat, expert-interview, source-monitor, lab-reports,
// and TDS's keyword classifier) instead of each independently describing
// "chemical family or sub-category" in free prose, which is exactly what
// let the same concept drift into different wording per prompt before.
export function buildFamilyGuideText() {
  return Object.entries(FAMILY_TAXONOMY)
    .map(([hub, families]) => `- ${hub}: ${families.join(" | ")}`)
    .join("\n");
}

// Server-side enforcement, not just prompt compliance — an LLM given a
// fixed list will usually comply, but "usually" isn't the guarantee a fixed
// taxonomy is supposed to provide. A value that's genuinely on the hub's
// list passes through; a non-empty value that ISN'T (model drifted, or a
// human typed something free-form into the edit modal) becomes "Other"
// rather than silently fragmenting the taxonomy again; empty/null stays
// null (nothing was said, not "Other" — those are different states). Hubs
// with no taxonomy entry (competitor, general, custom hubs) pass through
// unchanged — a fixed list would contradict their open-ended purpose.
export function normalizeFamily(hub, family) {
  const options = FAMILY_TAXONOMY[hub];
  if (!options) return family || null;
  if (!family) return null;
  return options.includes(family) ? family : "Other";
}

export const DEFECT_SEVERITIES = ["low", "medium", "high", "critical"];
export const DEFECT_SCHEMA_VERSION = 1;

// The full set of typed keys a "defects" node's defectSchema should carry.
// Every key should be PRESENT (even if its value is null) once a node has
// gone through classification — a key that's entirely absent means the
// node was never classified into this schema at all (legacy node, or a
// reclassification pass that failed outright).
export const DEFECT_SCHEMA_FIELDS = [
  "defect_type", "root_cause", "severity", "frequency", "affected_product",
  "related_materials", "detection_method", "corrective_action", "source_ref",
];

// Template for a freshly-classified node with nothing determined yet —
// used both as a starting point by extraction/reclassification code and as
// the canonical "shape" reference for validation.
export function createEmptyDefectSchema() {
  return {
    version: DEFECT_SCHEMA_VERSION,
    defect_type: null,
    root_cause: null,
    severity: null,
    frequency: null,
    affected_product: null,
    related_materials: null,
    detection_method: null,
    corrective_action: null,
    source_ref: null,
  };
}

// ── Validation ───────────────────────────────────────────────────────────
// NULL SEMANTICS: null means "not yet classified," not "not applicable."
// A defect with severity=null should be flagged for re-extraction or user
// review — it is NOT the same as a defect that genuinely has no severity
// (there is no such thing; every real defect has some severity, it just
// may not have been determined yet). The same reasoning applies to every
// other field here: a null is a gap to fill, not a confirmed absence.
//
// Takes the FULL learning node (not just the defectSchema sub-object) so it
// can distinguish "legacy node, never classified" (no defectSchema key at
// all) from "classified but incomplete" (defectSchema present, some keys
// missing or null) — these are different situations for a caller deciding
// whether to re-run extraction versus just flagging a review.
export function validateDefectSchema(node) {
  const missing_fields = [];
  const warnings = [];

  if (node?.hub && node.hub !== "defects") {
    // Being asked to validate a non-defects node against this schema is a
    // caller bug, not a data problem — surface it plainly rather than
    // silently validating the wrong hub's node.
    return { valid: false, missing_fields: ["hub mismatch: expected 'defects', got '" + node.hub + "'"], warnings: [] };
  }

  const schema = node?.defectSchema;
  if (!schema) {
    // Legacy node, pre-Phase-1 — a valid, expected state (every node
    // written before this schema existed looks like this), not an error.
    return { valid: true, missing_fields: ["defectSchema"], warnings: ["legacy node — no defectSchema present; not yet classified"] };
  }

  if (typeof schema.version !== "number") missing_fields.push("version");

  for (const key of DEFECT_SCHEMA_FIELDS) {
    if (!(key in schema)) { missing_fields.push(key); continue; }
    const value = schema[key];

    if (key === "severity" && value !== null && !DEFECT_SEVERITIES.includes(value)) {
      missing_fields.push(`severity (invalid value: ${JSON.stringify(value)} — must be one of ${DEFECT_SEVERITIES.join("|")} or null)`);
      continue;
    }
    if (key === "related_materials" && value !== null && !Array.isArray(value)) {
      missing_fields.push(`related_materials (invalid value: expected array or null, got ${typeof value})`);
      continue;
    }
    if (key === "related_materials" && Array.isArray(value) && !value.every(v => typeof v === "string")) {
      missing_fields.push("related_materials (invalid value: array must contain only strings)");
      continue;
    }
    if (value !== null && key !== "related_materials" && typeof value !== "string") {
      missing_fields.push(`${key} (invalid value: expected string or null, got ${typeof value})`);
      continue;
    }

    // Valid so far — flag the specific nulls/empties that are worth a
    // human's attention even though they're structurally fine.
    if (key === "severity" && value === null) warnings.push("severity is null — not yet classified, consider re-extraction or review");
    if (key === "root_cause" && value === null) warnings.push("root_cause is null — not yet classified, consider re-extraction or review");
    if (key === "related_materials" && Array.isArray(value) && value.length === 0) warnings.push("related_materials is an empty array — valid, but worth confirming nothing was missed");
  }

  return { valid: missing_fields.length === 0, missing_fields, warnings };
}

// ── Dispatcher ───────────────────────────────────────────────────────────
// Phase 1 covers only "defects". Every other hub returns null — callers
// must fall back to the generic (title/content/tags) handling for those,
// exactly as they do today. Extending this to another hub later means
// adding one more case here, not changing this function's contract.
export function getSchemaForHub(hubKey) {
  switch (hubKey) {
    case "defects":
      return { validate: validateDefectSchema, empty: createEmptyDefectSchema, fields: DEFECT_SCHEMA_FIELDS, version: DEFECT_SCHEMA_VERSION };
    case "synthesis_insight":
      return { validate: validateInsightSchema, empty: createEmptyInsightSchema, fields: ["type", "reasoning", "supporting_nodes", "action_suggestion", "disclaimer"], version: SYNTHESIS_INSIGHT_SCHEMA_VERSION };
    case "document_template":
      return { validate: validateDocumentTemplateSchema, empty: createEmptyDocumentTemplateSchema, fields: ["section_names", "section_order", "formatting_rules", "placeholder_keys", "source_document_name"], version: DOCUMENT_TEMPLATE_SCHEMA_VERSION };
    case "competitor":
      return { validate: validateCompetitorSchema, empty: createEmptyCompetitorSchema, fields: ["company_name", "revenue", "employee_count", "hiring_activity", "acquisitions", "key_products", "technologies", "patents", "recent_news", "people_mentioned", "github_presence", "community_mentions", "registry_info", "academic_mentions", "confidence_score", "enrichment_score", "company_maturity", "consistency_check", "aggregator_warning", "last_updated"], version: COMPETITOR_SCHEMA_VERSION };
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════
// Provenance / audit trail — Memory ROADMAP.md Phase 3.
//
// Deliberately a SEPARATE field from the existing `confidence` (1-5 int,
// bumped by usage — see memory.js addLearning/confirmLearningUsed). That
// field stays untouched everywhere it's read today (staleness detection,
// chat-context injection text). `confidenceScore` (0-100) below is new,
// provenance-derived, and set once at creation (plus a +10/-20 adjustment
// on validation/conflict) — the two scales measure different things and
// are not meant to be reconciled into one.
// ═══════════════════════════════════════════════════

// "upload" = a full document was read (TDS/SDS/PDF extraction, /extract,
// /extract-sds, /add-knowledge, /extract-trial, /chat-with-file).
// "chat" = extracted from free-text conversation with no attached document.
// "monitor" = the Phase 2 source-monitor pipeline (sourceRunner.js).
// "manual" = a specific user-triggered action that isn't raw chat or a
// document read (a direct "add to Memory" form, qc-check, supplier-radar,
// competitor-analysis, or curated seed/baseline data).
// "synthesis" = reserved for Phase 4's cross-hub synthesis agent.
// "expert-interview" = a named domain expert's deliberate, guided-interview
// answer (services/expertInterview.js) — a person speaking on the record
// about their own tacit knowledge, not an offhand chat remark, so it starts
// above "manual"/"chat" but below "upload" since it's still spoken/
// interpreted content rather than a verified source document.
export const PROVENANCE_SOURCE_TYPES = ["upload", "chat", "monitor", "manual", "synthesis", "expert-interview"];

// Confidence bands per source_type, per Phase 3's spec — a full document
// carries more evidentiary weight than a chat inference. "manual" isn't in
// the original spec (which only named upload/monitor/chat) but the enum
// above needs somewhere to put direct-add/QC/supplier/competitor saves;
// treated as a notch below "upload" since a person typed it deliberately
// but it isn't sourced from a read document. "synthesis" mirrors Phase 4's
// stated baseline (30-50) so the field means the same thing once that
// phase lands.
const CONFIDENCE_BANDS = {
  upload: [85, 95],
  monitor: [70, 85],
  "expert-interview": [70, 85],
  manual: [60, 75],
  chat: [50, 70],
  synthesis: [30, 50],
};

// Deterministic midpoint rather than a random roll within the band — two
// nodes saved the same way should start at the same score, and test
// assertions need a stable value, not a range to re-check every run.
export function computeConfidenceScore(sourceType) {
  const band = CONFIDENCE_BANDS[sourceType] || CONFIDENCE_BANDS.chat;
  return Math.round((band[0] + band[1]) / 2);
}

// Fresh provenance block for a brand-new node. `source_type` should always
// be passed explicitly by the caller (addLearning defaults it to "chat" if
// omitted, matching today's de facto behavior where most call sites never
// set sourceType either).
export function createEmptyProvenance(sourceType, { sourceUri = null, sourceContentHash = null, extractorModel = null, extractorPromptHash = null } = {}) {
  const type = PROVENANCE_SOURCE_TYPES.includes(sourceType) ? sourceType : "chat";
  return {
    source_type: type,
    source_uri: sourceUri,
    source_content_hash: sourceContentHash,
    extractor_model: extractorModel,
    extractor_prompt_hash: extractorPromptHash,
    extracted_at: new Date().toISOString(),
    confidenceScore: computeConfidenceScore(type),
    validated_by: null,
    validated_at: null,
    supersedes: null,
  };
}

// ═══════════════════════════════════════════════════
// Cross-hub synthesis insights — Memory ROADMAP.md Phase 4.
//
// A new typed schema for the "synthesis_insight" hub, following exactly
// the same additive pattern as Phase 1's defectSchema: base node fields
// (title/content/tags/hub) stay generic, this is the extra structured
// layer. `confidence` is deliberately NOT part of this schema — every node
// already carries Phase 3's `confidenceScore` (0-100), and duplicating it
// here would just create a second source of truth to keep in sync.
// ═══════════════════════════════════════════════════

export const INSIGHT_TYPES = ["trend", "risk", "opportunity", "gap", "contradiction"];
export const SYNTHESIS_INSIGHT_SCHEMA_VERSION = 1;
export const INSIGHT_DISCLAIMER = "Speculative insight — verify before acting";

export function createEmptyInsightSchema() {
  return {
    version: SYNTHESIS_INSIGHT_SCHEMA_VERSION,
    type: null,
    reasoning: null,
    supporting_nodes: [],
    action_suggestion: null,
    disclaimer: INSIGHT_DISCLAIMER,
  };
}

// Same contract as validateDefectSchema: takes the FULL node, returns
// {valid, missing_fields, warnings}. Unlike defectSchema (where nulls are
// meaningful "not yet classified" gaps), an insight with a null `type` or
// `reasoning` is simply malformed — there's no legitimate reason for the
// synthesis agent to produce one without these, so those are hard
// failures, not warnings.
export function validateInsightSchema(node) {
  const missing_fields = [];
  const warnings = [];

  if (node?.hub && node.hub !== "synthesis_insight") {
    return { valid: false, missing_fields: ["hub mismatch: expected 'synthesis_insight', got '" + node.hub + "'"], warnings: [] };
  }

  const schema = node?.insightSchema;
  if (!schema) {
    return { valid: false, missing_fields: ["insightSchema"], warnings: ["no insightSchema present — not a valid synthesis insight"] };
  }

  if (typeof schema.version !== "number") missing_fields.push("version");
  if (!INSIGHT_TYPES.includes(schema.type)) missing_fields.push(`type (invalid value: ${JSON.stringify(schema.type)} — must be one of ${INSIGHT_TYPES.join("|")})`);
  if (typeof schema.reasoning !== "string" || !schema.reasoning.trim()) missing_fields.push("reasoning (must be a non-empty string — the chain of thought)");
  if (!Array.isArray(schema.supporting_nodes) || !schema.supporting_nodes.every(v => typeof v === "string")) {
    missing_fields.push("supporting_nodes (must be an array of node id strings)");
  } else if (schema.supporting_nodes.length < 2) {
    // Safety constraint from the spec: no single-source speculation.
    missing_fields.push("supporting_nodes (must have at least 2 entries — no single-source speculation)");
  }
  if (schema.action_suggestion !== null && typeof schema.action_suggestion !== "string") missing_fields.push("action_suggestion (must be a string or null)");
  if (schema.disclaimer !== INSIGHT_DISCLAIMER) warnings.push("disclaimer does not match the standard wording — overwrite with the canonical string rather than trusting model output");

  return { valid: missing_fields.length === 0, missing_fields, warnings };
}

// ═══════════════════════════════════════════════════
// TDS document templates — "FIX 3" template-learning feature.
//
// A document_template node captures the STRUCTURE of a sample TDS a user
// uploads (section names, their order, and whatever formatting cues are
// genuinely recoverable) so a later generation pass can reuse that exact
// structure instead of Claude inventing a fresh layout every time.
//
// Deliberately NOT capturing literal typography (font family, exact point
// sizes, colors): the two realistic input paths are pasted plain text and
// pdf-parse-extracted PDF text (same extraction path /extract already
// uses), and BOTH strip font/color information entirely before the model
// ever sees the content — there is nothing to extract it FROM. Claiming to
// capture "fonts" from plain text would mean inventing plausible-sounding
// values (e.g. "Arial 11pt") with zero grounding, which is exactly what
// this project's core discipline (never invent data; null over a guess)
// exists to prevent. formatting_rules instead captures STRUCTURAL cues that
// genuinely are visible in text: heading hierarchy, numbering/bullet style,
// and emphasis patterns (e.g. "section titles are ALL CAPS and numbered").
// ═══════════════════════════════════════════════════

export const DOCUMENT_TEMPLATE_SCHEMA_VERSION = 1;

export function createEmptyDocumentTemplateSchema() {
  return {
    version: DOCUMENT_TEMPLATE_SCHEMA_VERSION,
    section_names: [],
    section_order: [],
    formatting_rules: {
      heading_style: null,       // e.g. "numbered, ALL CAPS section titles"
      body_style: null,          // e.g. "short paragraphs, no bullet lists"
      emphasis_pattern: null,    // e.g. "key specs bolded inline"
      spacing_notes: null,       // e.g. "blank line between every section"
      // Explicitly null, not guessed — see the file header comment above.
      // Legacy flat pair, kept for templates/callers that predate the
      // per-role fields below.
      font_family: null,
      font_size: null,
      // Per-role fonts — real values only when read from a real .docx
      // (docxParser.js); null for text/PDF-sourced templates, same
      // "never guessed" rule as the legacy pair above.
      heading_font: null, heading_size: null,
      body_font: null, body_size: null,
      table_font: null, table_size: null,
    },
    placeholder_keys: [],
    // { [sectionHeading]: [{ rows: string[][], columnWidthsTwips: number[], borders }] }
    // Real table skeletons, docx-sourced templates only — omitted entirely
    // for text/PDF templates or templates saved before this existed.
    section_tables: {},
    source_document_name: null,
  };
}

// Same contract as the other typed schemas: {valid, missing_fields, warnings}.
// Like insightSchema (and unlike defectSchema), a document_template is
// created once from a single extraction pass, not gradually filled in over
// time — so a missing structural field is a real extraction failure, not a
// "not yet classified" state, and is a hard failure rather than a warning.
export function validateDocumentTemplateSchema(node) {
  const missing_fields = [];
  const warnings = [];

  if (node?.hub && node.hub !== "document_template") {
    return { valid: false, missing_fields: ["hub mismatch: expected 'document_template', got '" + node.hub + "'"], warnings: [] };
  }

  const schema = node?.documentTemplateSchema;
  if (!schema) {
    return { valid: false, missing_fields: ["documentTemplateSchema"], warnings: ["no documentTemplateSchema present — not a valid document template"] };
  }

  if (typeof schema.version !== "number") missing_fields.push("version");
  if (!Array.isArray(schema.section_names) || !schema.section_names.length || !schema.section_names.every(v => typeof v === "string")) {
    missing_fields.push("section_names (must be a non-empty array of strings)");
  }
  if (!Array.isArray(schema.section_order) || !schema.section_order.length || !schema.section_order.every(v => typeof v === "string")) {
    missing_fields.push("section_order (must be a non-empty array of strings)");
  } else if (Array.isArray(schema.section_names)) {
    const namesSet = new Set(schema.section_names);
    const orderSet = new Set(schema.section_order);
    if (namesSet.size !== orderSet.size || [...namesSet].some(n => !orderSet.has(n))) {
      warnings.push("section_order does not contain exactly the same sections as section_names — check for a mismatched extraction");
    }
  }
  if (typeof schema.formatting_rules !== "object" || schema.formatting_rules === null || Array.isArray(schema.formatting_rules)) {
    missing_fields.push("formatting_rules (must be an object)");
  }
  if (!Array.isArray(schema.placeholder_keys) || !schema.placeholder_keys.every(v => typeof v === "string")) {
    missing_fields.push("placeholder_keys (must be an array of strings, may be empty)");
  } else if (schema.placeholder_keys.length === 0) {
    warnings.push("placeholder_keys is empty — the template has no placeholders to fill during generation, check the extraction");
  } else {
    // Safety net for the extraction prompt's disambiguation instruction —
    // generateTdsSections fills exactly one value per placeholder NAME, so
    // two different real occurrences sharing one name means one silently
    // loses its data (this is what caused every field to render
    // [DATA NOT PROVIDED] despite a fully-populated confirmation card: a
    // TDS table applies generic column headers like Method/Unit/Value to
    // many different rows, and without per-row disambiguation they all
    // collapse onto the same placeholder key). Same bracket/case
    // normalization generateTdsSections itself uses, so a case-only
    // variant ("[Value]" vs "[VALUE]") that would ALSO collide there is
    // caught here too, not just an exact literal repeat.
    const counts = new Map();
    for (const key of schema.placeholder_keys) {
      const norm = key.replace(/^\[|\]$/g, "").trim().toUpperCase();
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => `[${k}]`);
    if (duplicates.length) {
      missing_fields.push(`placeholder_keys has ambiguous/duplicate names used more than once: ${duplicates.join(", ")} — each must be renamed to identify which specific field it belongs to (e.g. [VALUE] appearing for both a viscosity row and a density row should become [VISCOSITY_VALUE] and [DENSITY_VALUE]) before this template can be saved`);
    }
  }
  if (schema.source_document_name !== null && typeof schema.source_document_name !== "string") {
    missing_fields.push("source_document_name (must be a string or null)");
  }
  // Optional — absent entirely on templates saved before visual-fidelity
  // capture existed, and on text/PDF-sourced templates (no real table
  // borders/widths to read from those). Only validated when present, so
  // older templates keep loading and generating exactly as before.
  if (schema.section_tables !== undefined) {
    if (typeof schema.section_tables !== "object" || schema.section_tables === null || Array.isArray(schema.section_tables)) {
      missing_fields.push("section_tables (must be an object keyed by section name, or omitted)");
    } else {
      for (const [heading, tables] of Object.entries(schema.section_tables)) {
        if (!Array.isArray(tables) || !tables.every(t => t && Array.isArray(t.rows))) {
          missing_fields.push(`section_tables["${heading}"] (must be an array of {rows: string[][], ...})`);
        }
      }
    }
  }

  return { valid: missing_fields.length === 0, missing_fields, warnings };
}

// ═══════════════════════════════════════════════════
// Competitor Intelligence — "360°" mission.
//
// Every fact-bearing field here follows one non-negotiable rule: a value
// without a source_url is not data, it's a guess, and this schema treats it
// as INVALID, not merely unconfident — validateCompetitorSchema hard-fails
// (missing_fields, not warnings) any field that has a value but no
// source_url. This is what makes "never invent a number" a structural
// guarantee enforced at the data layer, rather than only a system-prompt
// instruction the model could quietly ignore under pressure to fill a gap.
// A field with no findable source is expected to be null, in full — never
// "probably around X" with no link behind it.
//
// Deliberately deviates from the mission brief's literal `technologies:
// [string] | null` shape: a bare string array has nowhere to hang a source,
// which would make that one field exempt from the schema's own governing
// rule. Reshaped to `[{name, source_url}]` — same rule, no field-level
// carve-out. See competitor-intel.js (Phase 2) for the extractor that
// populates this shape.
// ═══════════════════════════════════════════════════

export const COMPETITOR_SCHEMA_VERSION = 1;

function emptySourcedFact() {
  return { value: null, source_url: null, source_name: null };
}

export function createEmptyCompetitorSchema() {
  return {
    version: COMPETITOR_SCHEMA_VERSION,
    company_name: null,
    revenue: emptySourcedFact(),           // value: {amount:number, unit:"actual"|"thousand"|"million"|"billion", currency:string, year:number} | null — `unit` is the magnitude the SOURCE stated (e.g. amount:98.7, unit:"million" for "€98.7 million"); a legacy node saved before this field existed simply won't have it, callers should treat a missing unit as "actual"
    employee_count: emptySourcedFact(),    // value: number | null
    hiring_activity: { open_positions: null, trend: null, source_url: null, founded_year: null, founded_year_source_url: null, employee_count_estimate: null, employee_count_source_url: null, role_pattern_summary: null }, // open_positions: [{title,department,url}] | null — founded_year/employee_count_estimate/role_pattern_summary are best-effort, read only when explicitly evidenced (never scraped directly, never inferred). role_pattern_summary is a judgment (e.g. "Primarily ML/AI engineering roles") only valid when clearly evidenced by multiple listings, same discipline as `trend`
    acquisitions: null,   // [{company_name, date, amount, source_url}] | null
    key_products: null,   // [{name, description, source_url}] | null
    technologies: null,   // [{name, source_url}] | null — see header comment on why this isn't a bare string array
    patents: null,        // [{number, title, date, source_url}] | null — date now genuinely populated when sourced from USPTO/EPO (structured APIs), still null for entries found only via generic web search
    recent_news: null,    // [{title, summary, date, url}] | null
    // ── Public-presence enrichment categories (Tavily-search-based, plus a
    // real Companies House API for UK registry lookups) — see
    // computeCompetitorEnrichmentScore below for why these are scored
    // separately from the 8 core categories above, not folded into
    // confidence_score.
    people_mentioned: null,   // [{name, role, source_url}] | null — named individuals from LinkedIn snippets, "employees team", or "founder CEO CTO" searches. Never a LinkedIn page fetch — search-engine-indexed snippets only.
    github_presence: null,    // [{repository_name, description, source_url}] | null — signals tech stack/OSS activity, not a full developer roster
    community_mentions: null, // [{title, summary, source_url}] | null — Reddit/forums/Q&A, same shape as recent_news
    registry_info: null,      // {country, registry_name, founding_date, directors: [string]|null, capital, source_url} | null — real Companies House API for UK; site-restricted Tavily search (site:[registry domain]) for IT/FR/DE and others
    academic_mentions: null,  // [{title, authors: [string]|null, source_url}] | null — ResearchGate/arXiv/Scholar, all via Tavily site-restricted search, never direct scraping
    confidence_score: 0,    // 0-100 — the ORIGINAL 8 core categories only, unchanged in meaning/denominator from before this extension — see computeCompetitorConfidenceScore
    enrichment_score: 0,    // 0-100 — coverage across the 5 new enrichment categories above, scored SEPARATELY so a company with no GitHub/community presence doesn't silently drag down its core confidence_score — see computeCompetitorEnrichmentScore. Absent (undefined) on reports saved before this field existed — treat as "not computed", not as 0.
    company_maturity: null, // {classification:"established"|"growth_stage"|"early_stage"|"unverified", earliest_signal_date, earliest_signal_source, earliest_signal_type} | null — see computeCompanyMaturity in competitor-scraper.js. earliest_signal_type can now also be "registry" (highest-priority signal, above patent/linkedin — a government filing date is the most authoritative source available)
    consistency_check: null, // {consistent:boolean, reasoning:string|null} | null (null = check wasn't run — too little data to compare, or the check itself failed; NOT the same as consistent:true) — see checkCrossSourceConsistency in competitor-scraper.js
    aggregator_warning: null, // string | null — set when the submitted URL was a third-party aggregator page (Preqin, Crunchbase, etc.), not the company's own site — see resolveAggregatorUrl in competitor-scraper.js
    skipped_categories: [], // string[] — UI category keys (see COMPETITOR_CATEGORIES above) the user deliberately excluded before running this analysis; empty on every pre-category-selection report and on any run where everything was searched. Lets the frontend render "Not searched (excluded by user)" instead of "Not available" for the fields those categories own.
    last_updated: null,
  };
}

// Coverage, not sourcing-compliance — every non-null value already has a
// source enforced by the validator below, so scoring "% correctly sourced"
// would always read 100 on any object that passes validation at all. What's
// actually useful to show a user is "how much of this profile could be
// found and verified" — the fraction of the 8 fact categories that turned
// up at least one sourced item.
const COMPETITOR_FACT_CATEGORIES = ["revenue", "employee_count", "hiring_activity", "acquisitions", "key_products", "technologies", "patents", "recent_news"];

// Public-presence enrichment categories — scored separately from the 8
// core categories above (see computeCompetitorEnrichmentScore) so a
// company with, say, no GitHub presence or Reddit mentions doesn't read
// as less "confident" on the core financial/technical/IP facts that
// confidence_score has always measured. Not every real company has a
// public GitHub org or gets talked about on Reddit — that's normal, not
// a sign the analysis itself is weak.
const COMPETITOR_ENRICHMENT_CATEGORIES = ["people_mentioned", "github_presence", "community_mentions", "registry_info", "academic_mentions"];

// ═══════════════════════════════════════════════════
// User-facing category selection (checkboxes before running an analysis —
// see competitor-scraper.js's buildCompetitorProfile `categories` option).
// Single source of truth mapping each selectable UI category to the
// schema fact keys it controls, so the frontend checkbox list, the
// fetcher-gating in buildCompetitorProfile, and the score-denominator
// shrinking below all agree on the same 6 keys without drifting apart.
// "maturity" has no factKeys of its own — company_maturity is a free
// derived computation over financial/technical/patents/public_presence
// data already fetched, not its own network call — see
// computeCompanyMaturity's header in competitor-scraper.js.
// ═══════════════════════════════════════════════════
export const COMPETITOR_CATEGORIES = {
  financial:        { label: "Financial",        factKeys: ["revenue", "employee_count"] },
  technical:        { label: "Technical",        factKeys: ["key_products", "technologies"] },
  patents:          { label: "IP & Patents",      factKeys: ["patents"] },
  news_hiring:      { label: "News & Hiring",     factKeys: ["hiring_activity", "acquisitions", "recent_news"] },
  public_presence:  { label: "Public Presence (People / GitHub / Registry / Academic / Community)", factKeys: ["people_mentioned", "github_presence", "community_mentions", "registry_info", "academic_mentions"], enrichment: true },
  maturity:         { label: "Company Maturity signal detection", factKeys: [] },
};
export const ALL_COMPETITOR_CATEGORY_KEYS = Object.keys(COMPETITOR_CATEGORIES);

// Expands a set of EXCLUDED category keys into the flat fact-key lists
// each score denominator needs to drop — used by computeCompetitor*Score
// below and by buildCompetitorProfile to decide which fetchers to skip.
export function competitorFactKeysForCategories(categoryKeys) {
  return categoryKeys.flatMap(k => COMPETITOR_CATEGORIES[k]?.factKeys || []);
}

function competitorCategoryHasData(schema, key) {
  if (key === "revenue") return schema?.revenue?.value != null;
  if (key === "employee_count") return schema?.employee_count?.value != null;
  if (key === "hiring_activity") return !!(schema?.hiring_activity?.open_positions?.length || schema?.hiring_activity?.trend);
  if (key === "registry_info") return !!(schema?.registry_info?.founding_date || schema?.registry_info?.directors?.length || schema?.registry_info?.capital);
  const v = schema?.[key];
  return Array.isArray(v) && v.length > 0;
}

// attemptedKeys defaults to the full 8 — every existing caller (scheduled
// refresh, tests, any report predating category selection) keeps producing
// the exact same numbers as before this extension. When the caller
// deliberately searched only a subset (categories param on
// buildCompetitorProfile), the denominator shrinks to just what was
// actually attempted — a category the user excluded must never count as a
// "failed to find" against the score. Returns null (not 0) when nothing
// was attempted at all, since a 0% would misread as "searched everywhere,
// found nothing" rather than "nothing was asked for."
export function computeCompetitorConfidenceScore(schema, attemptedKeys = COMPETITOR_FACT_CATEGORIES) {
  if (!attemptedKeys.length) return null;
  const found = attemptedKeys.filter(k => competitorCategoryHasData(schema, k)).length;
  return Math.round((found / attemptedKeys.length) * 100);
}

export function computeCompetitorEnrichmentScore(schema, attemptedKeys = COMPETITOR_ENRICHMENT_CATEGORIES) {
  if (!attemptedKeys.length) return null;
  const found = attemptedKeys.filter(k => competitorCategoryHasData(schema, k)).length;
  return Math.round((found / attemptedKeys.length) * 100);
}

function requireSourceIfValued(missing_fields, label, sourceUrl, hasValue) {
  if (hasValue && (typeof sourceUrl !== "string" || !sourceUrl.trim())) {
    missing_fields.push(`${label}.source_url (mandatory once a value is present — never report a fact without its source)`);
  }
}

// itemUrlKey defaults to "source_url"; recent_news uses "url" per the
// mission's own field naming (kept as specified rather than normalized,
// since renaming it would just be churn for no behavioral difference).
function validateSourcedArray(missing_fields, warnings, schema, key, requiredKeys, itemUrlKey = "source_url") {
  const arr = schema[key];
  if (arr === undefined) { missing_fields.push(key); return; }
  if (arr === null) return; // legitimate "nothing found" — not an error
  if (!Array.isArray(arr)) { missing_fields.push(`${key} (must be an array or null)`); return; }
  arr.forEach((item, i) => {
    for (const k of requiredKeys) {
      if (item?.[k] === undefined || item?.[k] === null || item?.[k] === "") missing_fields.push(`${key}[${i}].${k} (required)`);
    }
    if (!item?.[itemUrlKey] || typeof item[itemUrlKey] !== "string" || !item[itemUrlKey].trim()) {
      missing_fields.push(`${key}[${i}].${itemUrlKey} (mandatory — every entry must carry a verifiable, clickable source link)`);
    }
  });
  if (arr.length === 0) warnings.push(`${key} is an empty array — prefer null when nothing was found`);
}

// Same contract as the other typed schemas: {valid, missing_fields, warnings}.
// Like document_template, a competitor profile is produced by one extraction
// pass (re-run to refresh, not incrementally filled), so a missing
// structural field is a real extraction failure — hard failure, not a
// warning. Individual fact values being null is NOT a failure (it's the
// expected, honest outcome when no source exists) — see the "fake company"
// test case in competitor-intel.test.js, which asserts a report of all
// nulls is VALID, not an error.
export function validateCompetitorSchema(node) {
  const missing_fields = [];
  const warnings = [];

  if (node?.hub && node.hub !== "competitor") {
    return { valid: false, missing_fields: ["hub mismatch: expected 'competitor', got '" + node.hub + "'"], warnings: [] };
  }

  const schema = node?.competitorSchema;
  if (!schema) {
    return { valid: false, missing_fields: ["competitorSchema"], warnings: ["no competitorSchema present — not a valid competitor report"] };
  }

  if (typeof schema.version !== "number") missing_fields.push("version");
  if (typeof schema.company_name !== "string" || !schema.company_name.trim()) missing_fields.push("company_name (required, non-empty string)");

  if (schema.revenue && typeof schema.revenue === "object") {
    const hasValue = schema.revenue.value != null;
    requireSourceIfValued(missing_fields, "revenue", schema.revenue.source_url, hasValue);
    if (hasValue) {
      const v = schema.revenue.value;
      if (typeof v.amount !== "number" || typeof v.currency !== "string" || typeof v.year !== "number") {
        missing_fields.push("revenue.value (must be {amount:number, currency:string, year:number} or null)");
      }
    }
  } else missing_fields.push("revenue");

  if (schema.employee_count && typeof schema.employee_count === "object") {
    const hasValue = schema.employee_count.value != null;
    requireSourceIfValued(missing_fields, "employee_count", schema.employee_count.source_url, hasValue);
    if (hasValue && typeof schema.employee_count.value !== "number") missing_fields.push("employee_count.value (must be a number or null)");
  } else missing_fields.push("employee_count");

  if (schema.hiring_activity && typeof schema.hiring_activity === "object") {
    const hasValue = !!(schema.hiring_activity.open_positions?.length || schema.hiring_activity.trend);
    requireSourceIfValued(missing_fields, "hiring_activity", schema.hiring_activity.source_url, hasValue);
    if (schema.hiring_activity.open_positions != null) {
      if (!Array.isArray(schema.hiring_activity.open_positions)) {
        missing_fields.push("hiring_activity.open_positions (must be an array or null)");
      } else {
        schema.hiring_activity.open_positions.forEach((p, i) => {
          if (!p?.url || typeof p.url !== "string" || !p.url.trim()) missing_fields.push(`hiring_activity.open_positions[${i}].url (mandatory)`);
        });
      }
    }
  } else missing_fields.push("hiring_activity");

  validateSourcedArray(missing_fields, warnings, schema, "acquisitions", ["company_name"]);
  validateSourcedArray(missing_fields, warnings, schema, "key_products", ["name"]);
  validateSourcedArray(missing_fields, warnings, schema, "technologies", ["name"]);
  validateSourcedArray(missing_fields, warnings, schema, "patents", ["title"]);
  validateSourcedArray(missing_fields, warnings, schema, "recent_news", ["title"], "url");

  // Optional, backward-compatible enrichment categories — same lenient
  // "only validated when present" pattern as company_maturity/
  // consistency_check below, since reports saved before this extension
  // won't have any of these fields at all.
  if (schema.people_mentioned != null) validateSourcedArray(missing_fields, warnings, schema, "people_mentioned", ["name"]);
  if (schema.github_presence != null) validateSourcedArray(missing_fields, warnings, schema, "github_presence", ["repository_name"]);
  if (schema.community_mentions != null) validateSourcedArray(missing_fields, warnings, schema, "community_mentions", ["title"]);
  if (schema.academic_mentions != null) validateSourcedArray(missing_fields, warnings, schema, "academic_mentions", ["title"]);
  if (schema.registry_info != null && typeof schema.registry_info !== "object") {
    missing_fields.push("registry_info (must be an object or null)");
  }

  if (typeof schema.confidence_score !== "number" || schema.confidence_score < 0 || schema.confidence_score > 100) {
    missing_fields.push("confidence_score (must be a number 0-100)");
  }
  if (schema.enrichment_score != null && (typeof schema.enrichment_score !== "number" || schema.enrichment_score < 0 || schema.enrichment_score > 100)) {
    missing_fields.push("enrichment_score (must be a number 0-100, or absent on pre-extension reports)");
  }
  if (schema.last_updated !== null && typeof schema.last_updated !== "string") {
    missing_fields.push("last_updated (must be an ISO timestamp string or null)");
  }

  // Optional, backward-compatible — added for early-signal detection.
  // Analyses saved before this existed simply won't have it; only
  // validated (leniently) when present, same pattern as
  // document_template's section_tables.
  const MATURITY_CLASSIFICATIONS = ["established", "growth_stage", "early_stage", "unverified"];
  if (schema.company_maturity != null) {
    if (typeof schema.company_maturity !== "object") {
      missing_fields.push("company_maturity (must be an object or absent)");
    } else if (!MATURITY_CLASSIFICATIONS.includes(schema.company_maturity.classification)) {
      missing_fields.push(`company_maturity.classification (must be one of ${MATURITY_CLASSIFICATIONS.join("|")})`);
    }
  }

  // Same optional/lenient/backward-compatible pattern as company_maturity
  // above — added for the cross-source consistency check.
  if (schema.consistency_check != null && typeof schema.consistency_check.consistent !== "boolean") {
    missing_fields.push("consistency_check.consistent (must be a boolean when consistency_check is present)");
  }

  if (schema.aggregator_warning != null && typeof schema.aggregator_warning !== "string") {
    missing_fields.push("aggregator_warning (must be a string or null)");
  }

  return { valid: missing_fields.length === 0, missing_fields, warnings };
}
