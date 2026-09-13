const TEXT_FIELD_TYPES = new Set([
  "textarea",
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
]);

const REQUEST_PREFIX =
  "CLOSER needs one required application answer before it can continue.\nQuestion: ";
const REQUEST_SUFFIX =
  "\nReply to this request in the dashboard. The answer is saved under the " +
  "question's exact normalized key and reused only for an identical key.";

type AnswerShape = { fieldType: string; options: string[] };

function assertAnswerShape(shape: AnswerShape, reply: string): void {
  const { fieldType, options } = shape;
  if (fieldType === "radio" || fieldType === "select") {
    if (!options.includes(reply)) throw new Error("closer_answer_not_exact_option");
    return;
  }
  if (fieldType === "checkbox") {
    if (reply !== "Yes" && reply !== "No") {
      throw new Error("closer_answer_not_exact_option");
    }
    return;
  }
  if (fieldType === "checkboxes") {
    let selected: unknown;
    try {
      selected = JSON.parse(reply);
    } catch {
      throw new Error("closer_answer_not_exact_option");
    }
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.some(
        (option) => typeof option !== "string" || !options.includes(option),
      ) ||
      new Set(selected).size !== selected.length
    ) {
      throw new Error("closer_answer_not_exact_option");
    }
    return;
  }
  if (TEXT_FIELD_TYPES.has(fieldType) && options.length === 0) return;
  throw new Error("closer_answer_payload_invalid");
}

function answerShapeFromBody(body: string): AnswerShape | null {
  if (!body.startsWith(REQUEST_PREFIX) || !body.endsWith(REQUEST_SUFFIX)) {
    return null;
  }
  const middle = body.slice(REQUEST_PREFIX.length, -REQUEST_SUFFIX.length);
  const fieldDelimiter = "\nField type: ";
  const fieldAt = middle.lastIndexOf(fieldDelimiter);
  if (fieldAt <= 0) return null;
  const label = middle.slice(0, fieldAt);
  const remainder = middle.slice(fieldAt + fieldDelimiter.length);
  const optionsDelimiter = "\nOptions:\n";
  const optionsAt = remainder.indexOf(optionsDelimiter);
  const fieldType = optionsAt < 0 ? remainder : remainder.slice(0, optionsAt);
  const options =
    optionsAt < 0
      ? []
      : remainder
          .slice(optionsAt + optionsDelimiter.length)
          .split("\n")
          .map((line) => (line.startsWith("- ") ? line.slice(2) : ""));
  if (
    !label ||
    !fieldType ||
    options.some((option) => !option) ||
    new Set(options).size !== options.length
  ) {
    return null;
  }
  return { fieldType, options };
}

export function isApplicationAnswerRequestBody(body: string): boolean {
  return answerShapeFromBody(body) !== null;
}

export function assertCloudApplicationAnswerReply(
  body: string,
  reply: string,
): void {
  const shape = answerShapeFromBody(body);
  if (!shape) throw new Error("closer_answer_payload_invalid");
  assertAnswerShape(shape, reply);
}

/**
 * Validate a dashboard answer against the exact control metadata captured by
 * CLOSER. This runs before either the reply or a renewed apply authorisation
 * is written, so a typo remains correctable in the same dashboard request.
 */
export function assertApplicationAnswerReply(
  payloadText: string | null,
  reply: string,
  relatedPositionId: string | number,
): void {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText ?? "");
  } catch {
    throw new Error("closer_answer_payload_invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("closer_answer_payload_invalid");
  }
  const record = payload as Record<string, unknown>;
  const fieldType = record.field_type;
  const options = record.options;
  if (
    record.version !== 1 ||
    String(record.position_id) !== String(relatedPositionId) ||
    typeof record.key !== "string" ||
    !record.key ||
    typeof record.label !== "string" ||
    !record.label ||
    typeof fieldType !== "string" ||
    !Array.isArray(options) ||
    options.some((option) => typeof option !== "string" || !option) ||
    new Set(options).size !== options.length
  ) {
    throw new Error("closer_answer_payload_invalid");
  }

  assertAnswerShape({ fieldType, options }, reply);
}
