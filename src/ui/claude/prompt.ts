// Text handed to Claude: a one-off prompt (instructions + format + the current model) and a reusable skill.
import { serializeModel, type DataModel } from '../../core';
import formatDoc from '../../../docs/model-format.md?raw';


/** Shared by the prompt and the skill, so both produce files the app can load. */
const RULES = `- Return the **complete** updated model as a single \`\`\`json code block (and, if you can create files, also as a downloadable \`.json\` file). Never return a partial model or a diff — it will be loaded as-is.
- Keep \`"format": "entitymodeler"\` and \`"format_version": 1\`.
- Keep every existing entity, attribute, relationship, hierarchy, area and note unless the request changes it.
- Things are referenced by \`name\` across the file (\`reference.entity\`, \`output_attribute\`, \`dependent_reference\`, relationship \`source\`/\`target\`, hierarchy branches). If you rename something, update every reference to it.
- Keep existing \`ui\` positions exactly. Do not add \`ui\` to new entities — the app lays them out.
- Names: entities, relationships and hierarchies are lowercase snake_case (\`^[a-z][a-z0-9_]*$\`); attribute names start with a letter and use letters, digits and underscores. Give every entity a \`display_name\` and every attribute a Title Case \`label\`.
- Each entity has exactly one \`is_primary_key\` attribute (its business key) and one \`is_label\` attribute (its display name).
- Use \`entity_type: "reference"\` for controlled code lists (country, currency, status, type codes) and point at them with \`REFERENCE_ENTITY\` attributes (\`reference.entity\` must be a reference entity; \`reference.output_attribute\` must be one of its attributes). Everything else is \`"standard"\`.
- \`STRUCT\` attributes need a matching entry in that entity's \`struct_types\`; struct fields are scalars or REFERENCE_ENTITY only.
- Relationship endpoints must be existing entities; a bidirectional relationship needs a reverse label that differs from the forward label. Set a relationship's \`required\` to true when the child can't exist without the parent. Set a relationship's \`foreign_key\` to the child attribute holding the parent's key (the source for N:1/1:1, the target for 1:N) when it isn't simply named after the parent's primary key.
- Write short, plain \`description\`s of business meaning. Use realistic but fictional \`example\` values; never invent facts about real systems or data.
- Ignore the CLI commands mentioned in the format reference — the user applies your JSON in the app.`;

const REPLY_SHAPE = `Before the JSON, summarize what you changed in a few bullets. After it, list any open questions or assumptions.`;

export interface PromptOptions {
  /** The model to change; omit to design a new one. */
  model?: DataModel;
  /** What the user wants; a placeholder is used when empty. */
  request?: string;
}

export function buildPrompt({ model, request }: PromptOptions): string {
  const ask = request?.trim() || (model ? '[Describe the change you want here]' : '[Describe the model you want: the business area, the main things and how they relate, any source tables or lists]');
  const intro = model
    ? `I'm editing a data model in EntityModel.com, an entity-relationship modeling tool. The model is one JSON document; its format is described below. Please update it as requested.`
    : `I'm designing a data model in EntityModel.com, an entity-relationship modeling tool. The model is one JSON document; its format is described below. Please create it from my description.`;
  const current = model
    ? `## Current model\n\n\`\`\`json\n${serializeModel(model).trimEnd()}\n\`\`\``
    : `## Starting point\n\nCreate a new model. Choose a short snake_case \`name\` and a clear \`title\`, set \`created_at\`/\`updated_at\` to the current time (ISO 8601), \`status\` to "draft" and \`version\` to "0.1", and include empty \`areas\` and \`notes\` arrays.`;
  return [intro, `## What I want\n\n${ask}`, `## Rules for your answer\n\n${RULES}\n\n${REPLY_SHAPE}`, current, `## Model format reference\n\n${formatDoc.trim().replace(/^(#+) /gm, '$1## ')}`].join('\n\n') + '\n';
}

export const SKILL_NAME = 'entity-modeler';

/** Files of the reusable skill, keyed by path inside the zip. */
export function skillFiles(): Record<string, string> {
  const skill = `---
name: ${SKILL_NAME}
description: Create or update EntityModel.com data models — the .json model files the app opens and exports. Use when the user shares an EntityModel.com model JSON (pasted or attached) and asks for changes, or asks to design an entity-relationship model to open in EntityModel.com.
---

# EntityModel.com models

EntityModel.com is a browser-based entity-relationship modeling tool. A model is one JSON document; the user exports it from the app (Export → Model file) and loads your result back (Design with Claude → paste, or Open model file on the home page).

## Steps

1. Read \`reference/model-format.md\` for the file format before writing any JSON.
2. If the user gave you a model, treat it as the current state and change only what they ask. If not, create a new model from their description.
3. Apply the rules below, then reply in the shape described at the end.

## Rules

${RULES}

## Reply

${REPLY_SHAPE} If the request is ambiguous, ask before producing JSON.
`;
  return { [`${SKILL_NAME}/SKILL.md`]: skill, [`${SKILL_NAME}/reference/model-format.md`]: formatDoc };
}
