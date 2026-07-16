/**
 * Durable, presentation-agnostic facts used by authored objectives.
 *
 * Facts belong in saved knowledge state. They deliberately do not depend on
 * the bounded event log: events may announce a discovery, but they are not the
 * source of truth for whether the player already knows or accomplished it.
 */

export const MAX_OBJECTIVE_FACTS = 256;
export const MAX_OBJECTIVE_FACT_SUBJECT_ID_LENGTH = 96;

export const OBJECTIVE_FACT_VERBS = [
  "visit",
  "inspect",
  "observe",
  "discover",
  "collect",
  "craft",
  "build",
  "use",
  "consume",
  "treat",
  "activate",
  "defeat",
  "survive",
  "choose",
  "heard",
  "observed",
  "prepared",
  "changedWorld",
  "reported",
] as const;

export type ObjectiveFactVerb = (typeof OBJECTIVE_FACT_VERBS)[number];

export interface ObjectiveFactRecord {
  verb: ObjectiveFactVerb;
  subjectId: string;
  /** Earliest authoritative simulation tick at which this became known. */
  firstKnownTick: number;
}

export interface ObjectiveFactReference {
  verb: ObjectiveFactVerb;
  subjectId: string;
}

/** One clause is an OR: satisfying any referenced fact satisfies the clause. */
export interface ObjectiveFactClause {
  anyOf: readonly ObjectiveFactReference[];
}

/**
 * Guidance is complete when all of its clauses are satisfied. Optional copy is
 * carried for authored/UI consumers without coupling this module to React.
 */
export interface ObjectiveGuidanceStep {
  id: string;
  requirements: readonly ObjectiveFactClause[];
  title?: string;
  instruction?: string;
}

type ObjectiveFactCollection = readonly unknown[] | null | undefined;

const objectiveFactVerbs = new Set<ObjectiveFactVerb>(OBJECTIVE_FACT_VERBS);
const safeSubjectIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectiveFactVerb(value: unknown): value is ObjectiveFactVerb {
  return (
    typeof value === "string" &&
    objectiveFactVerbs.has(value as ObjectiveFactVerb)
  );
}

/**
 * Accepts only compact code identifiers. Invalid input is rejected instead of
 * being rewritten into a different, potentially colliding objective subject.
 */
export function sanitizeObjectiveFactSubjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const subjectId = value.trim();
  if (
    subjectId.length === 0 ||
    subjectId.length > MAX_OBJECTIVE_FACT_SUBJECT_ID_LENGTH ||
    !safeSubjectIdPattern.test(subjectId)
  ) {
    return null;
  }

  return subjectId;
}

export function normalizeObjectiveFactReference(
  value: unknown,
): ObjectiveFactReference | null {
  if (!isRecord(value) || !isObjectiveFactVerb(value.verb)) return null;

  const subjectId = sanitizeObjectiveFactSubjectId(value.subjectId);
  if (subjectId === null) return null;

  return { verb: value.verb, subjectId };
}

export function normalizeObjectiveFactRecord(
  value: unknown,
): ObjectiveFactRecord | null {
  const reference = normalizeObjectiveFactReference(value);
  if (!reference || !isRecord(value)) return null;

  const rawTick = value.firstKnownTick;
  if (
    typeof rawTick !== "number" ||
    !Number.isSafeInteger(rawTick) ||
    rawTick < 0
  ) {
    return null;
  }

  return { ...reference, firstKnownTick: rawTick };
}

function objectiveFactKey(reference: ObjectiveFactReference): string {
  return `${reference.verb}\u0000${reference.subjectId}`;
}

/**
 * Normalizes, deduplicates, and bounds persisted facts. First-seen order is
 * stable; duplicates retain the earliest authoritative tick even when that
 * duplicate occurs after the capacity has been reached.
 */
export function dedupeObjectiveFacts(
  values: ObjectiveFactCollection,
): ObjectiveFactRecord[] {
  if (!Array.isArray(values)) return [];

  const facts: ObjectiveFactRecord[] = [];
  const indexByKey = new Map<string, number>();

  for (const value of values) {
    const fact = normalizeObjectiveFactRecord(value);
    if (!fact) continue;

    const key = objectiveFactKey(fact);
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      const existing = facts[existingIndex];
      if (fact.firstKnownTick < existing.firstKnownTick) {
        facts[existingIndex] = {
          ...existing,
          firstKnownTick: fact.firstKnownTick,
        };
      }
      continue;
    }

    if (facts.length >= MAX_OBJECTIVE_FACTS) continue;
    indexByKey.set(key, facts.length);
    facts.push(fact);
  }

  return facts;
}

/** Save-boundary aliases make the intended migration/sanitization call clear. */
export const normalizeObjectiveFacts = dedupeObjectiveFacts;
export const sanitizeObjectiveFacts = dedupeObjectiveFacts;

function normalizedReferenceKey(reference: unknown): string | null {
  const normalized = normalizeObjectiveFactReference(reference);
  return normalized ? objectiveFactKey(normalized) : null;
}

function normalizedFactTick(
  facts: readonly ObjectiveFactRecord[],
  reference: unknown,
): number | null {
  const key = normalizedReferenceKey(reference);
  if (key === null) return null;

  const fact = facts.find((candidate) => objectiveFactKey(candidate) === key);
  return fact?.firstKnownTick ?? null;
}

export function objectiveFactTick(
  values: ObjectiveFactCollection,
  reference: ObjectiveFactReference,
): number | null {
  return normalizedFactTick(dedupeObjectiveFacts(values), reference);
}

export function hasObjectiveFact(
  values: ObjectiveFactCollection,
  reference: ObjectiveFactReference,
): boolean {
  return objectiveFactTick(values, reference) !== null;
}

export function recordObjectiveFact(
  values: ObjectiveFactCollection,
  fact: ObjectiveFactRecord,
): ObjectiveFactRecord[];
export function recordObjectiveFact(
  values: ObjectiveFactCollection,
  reference: ObjectiveFactReference,
  firstKnownTick: number,
): ObjectiveFactRecord[];
export function recordObjectiveFact(
  values: ObjectiveFactCollection,
  referenceOrFact: ObjectiveFactReference | ObjectiveFactRecord,
  firstKnownTick?: number,
): ObjectiveFactRecord[] {
  const existing = dedupeObjectiveFacts(values);
  const candidate = normalizeObjectiveFactRecord(
    firstKnownTick === undefined
      ? referenceOrFact
      : { ...referenceOrFact, firstKnownTick },
  );

  return candidate ? dedupeObjectiveFacts([...existing, candidate]) : existing;
}

function normalizedClauseSatisfied(
  facts: readonly ObjectiveFactRecord[],
  clause: ObjectiveFactClause,
): boolean {
  return (
    Array.isArray(clause.anyOf) &&
    clause.anyOf.some(
      (reference) => normalizedFactTick(facts, reference) !== null,
    )
  );
}

function isObjectiveFactClause(value: unknown): value is ObjectiveFactClause {
  return isRecord(value) && Array.isArray(value.anyOf);
}

function isObjectiveGuidanceStep(
  value: unknown,
): value is ObjectiveGuidanceStep {
  return isRecord(value) && Array.isArray(value.requirements);
}

export function clauseSatisfied(
  values: ObjectiveFactCollection,
  clause: ObjectiveFactClause,
): boolean {
  if (!isRecord(clause)) return false;
  return normalizedClauseSatisfied(dedupeObjectiveFacts(values), clause);
}

export const objectiveClauseSatisfied = clauseSatisfied;

/** Multiple clauses are an AND. Tasks with no requirements are ready. */
export function taskRequirementsSatisfied(
  values: ObjectiveFactCollection,
  requirements: readonly ObjectiveFactClause[],
): boolean {
  if (!Array.isArray(requirements)) return false;
  const facts = dedupeObjectiveFacts(values);
  return requirements.every(
    (clause) =>
      isObjectiveFactClause(clause) && normalizedClauseSatisfied(facts, clause),
  );
}

export function firstUnsatisfiedGuidanceStep(
  values: ObjectiveFactCollection,
  steps: readonly ObjectiveGuidanceStep[],
): ObjectiveGuidanceStep | null {
  if (!Array.isArray(steps)) return null;
  const facts = dedupeObjectiveFacts(values);

  return (
    steps.find(
      (step) =>
        !isObjectiveGuidanceStep(step) ||
        !step.requirements.every(
          (clause) =>
            isObjectiveFactClause(clause) &&
            normalizedClauseSatisfied(facts, clause),
        ),
    ) ?? null
  );
}
