/**
 * Choice questions are numbered questions an agent writes in plain markdown, which the chat turns
 * into reply buttons. Tapping a button drops a chip such as `2B` into the composer; the chips are
 * ordinary editable composer content, so the user can reorder them, delete them, or write around
 * them, and they send as plain text (`1Y 2B`).
 *
 * The format is the one an agent naturally writes when asked for structured choices:
 *
 *   # Questions
 *
 *   **1. Merge now?** **(Y★)**
 *   - Context for the question.
 *
 *   **2. Pick a color:**
 *   - **A. Blue.** Short description.
 *   - **B. Green.** Short description. **(★)**
 *
 * `★` (or "(Recommended)") marks the agent's pick. `(Y★)`, `(N★)` or `(Y/N)` makes a yes/no
 * question. Under a "Questions" heading any numbered bold line is a question; elsewhere a line only
 * counts when it carries options or a yes/no marker, so numbered steps in ordinary prose stay text.
 */

export type ChoiceOptionId = string;

export interface ChoiceOption {
  /** `A`–`H`, `Y`, or `N`. */
  id: ChoiceOptionId;
  label: string;
  recommended: boolean;
}

export interface ChoiceQuestion {
  number: number;
  text: string;
  kind: "options" | "yes-no" | "open";
  options: ChoiceOption[];
  /** Markdown offset just past the question's last line; buttons render here. */
  end: number;
}

/** The pseudo-option that asks the agent to explain a question further. */
export const CHOICE_EXPLAIN_OPTION = "?";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUESTIONS_HEADING = /^(?:\*\*)?questions?\b/i;
const BOLD_QUESTION = /^ {0,3}(?:[-*+]\s+)?\*\*(\d{1,2})[.)]\s+(.+?)\*\*(.*)$/;
const BOLD_NUMBER = /^ {0,3}(?:[-*+]\s+)?\*\*(\d{1,2})[.)]\*\*\s+(.+)$/;
const LIST_QUESTION = /^ {0,3}(\d{1,2})[.)]\s+(.+)$/;
const OPTION = /^\s*(?:[-*+]\s+)?(\*\*)?([A-H])[.)]\s+(.+)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;
const YES_NO = /\(\s*(?:\*\*)?\s*([YN])\s*★\s*(?:\*\*)?\s*\)|\(\s*Y\s*\/\s*N\s*\)/i;
const RECOMMENDED = /★|\(recommended\)/i;
const MAX_LABEL_LENGTH = 48;

interface Line {
  text: string;
  start: number;
  end: number;
}

function splitLines(markdown: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start <= markdown.length) {
    const newline = markdown.indexOf("\n", start);
    const end = newline === -1 ? markdown.length : newline;
    lines.push({ text: markdown.slice(start, end), start, end });
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLabel(label: string): string {
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
}

function optionLabel(bold: boolean, body: string): string {
  // `**A. Blue.** Description` → the bold title; otherwise the first sentence.
  const title = bold ? (body.split("**")[0] ?? body) : (body.split(/(?<=[.!?])\s/)[0] ?? body);
  return clampLabel(
    stripMarkdown(title.replace(RECOMMENDED, ""))
      .replace(/[\s(]+$/, "")
      .replace(/[.:;,]$/, ""),
  );
}

function parseQuestionLine(
  text: string,
  inQuestionsSection: boolean,
): { number: number; text: string; marker: string } | null {
  const bold = BOLD_QUESTION.exec(text);
  if (bold) return { number: Number(bold[1]), text: bold[2]!, marker: bold[3] ?? "" };
  const boldNumber = BOLD_NUMBER.exec(text);
  if (boldNumber) return { number: Number(boldNumber[1]), text: boldNumber[2]!, marker: "" };
  if (!inQuestionsSection) return null;
  const listed = LIST_QUESTION.exec(text);
  if (!listed) return null;
  return { number: Number(listed[1]), text: listed[2]!, marker: "" };
}

function yesNoOptions(source: string): ChoiceOption[] | null {
  const match = YES_NO.exec(source);
  if (!match) return null;
  const recommended = match[1]?.toUpperCase();
  return [
    { id: "Y", label: "Yes", recommended: recommended === "Y" },
    { id: "N", label: "No", recommended: recommended === "N" },
  ];
}

/** Finds the reply-able questions in an assistant message, in order. */
export function parseChoiceQuestions(markdown: string): ChoiceQuestion[] {
  if (!markdown.includes("**") && !/^ {0,3}#{1,6}\s+questions?\b/im.test(markdown)) return [];
  const lines = splitLines(markdown);
  const questions: ChoiceQuestion[] = [];
  const seenNumbers = new Set<number>();
  let fence: string | null = null;
  let questionsLevel: number | null = null;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const fenceMatch = FENCE.exec(line.text);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1]!.startsWith(fence)) fence = null;
      index += 1;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading) {
      const level = heading[1]!.length;
      if (QUESTIONS_HEADING.test(heading[2]!)) questionsLevel = level;
      else if (questionsLevel !== null && level <= questionsLevel) questionsLevel = null;
      index += 1;
      continue;
    }

    const question = parseQuestionLine(line.text, questionsLevel !== null);
    if (!question) {
      index += 1;
      continue;
    }

    // The question owns the lines below it up to a blank line followed by prose, the next
    // question, a heading, or a fence. List items and paragraph continuations stay attached.
    let end = line.end;
    let previousBlank = false;
    const body: string[] = [];
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const candidate = lines[next]!.text;
      if (candidate.trim() === "") {
        previousBlank = true;
        continue;
      }
      if (
        FENCE.test(candidate) ||
        HEADING.test(candidate) ||
        parseQuestionLine(candidate, questionsLevel !== null)
      ) {
        break;
      }
      const attached = LIST_ITEM.test(candidate) || /^\s{2,}\S/.test(candidate) || !previousBlank;
      if (!attached) break;
      body.push(candidate);
      end = lines[next]!.end;
      previousBlank = false;
    }

    const options: ChoiceOption[] = [];
    for (const bodyLine of body) {
      const option = OPTION.exec(bodyLine);
      if (!option) continue;
      const id = option[2]!;
      // Only a run starting at A counts, so stray "I. …" lines don't become buttons.
      if (id !== String.fromCharCode(65 + options.length)) continue;
      options.push({
        id,
        label: optionLabel(option[1] !== undefined, option[3]!),
        recommended: RECOMMENDED.test(bodyLine),
      });
    }
    const yesNo = options.length < 2 ? yesNoOptions(`${question.text} ${question.marker}`) : null;
    const kind = options.length >= 2 ? "options" : yesNo ? "yes-no" : "open";
    const accepted = kind !== "open" || questionsLevel !== null;
    if (accepted && !seenNumbers.has(question.number)) {
      seenNumbers.add(question.number);
      questions.push({
        number: question.number,
        text: stripMarkdown(question.text.replace(YES_NO, "")),
        kind,
        options: kind === "options" ? options : (yesNo ?? []),
        end,
      });
    }
    index = next;
  }
  return questions;
}

// ── Composer chips ────────────────────────────────────────────────────────

export interface ChoiceChip {
  messageId: string;
  question: number;
  option: ChoiceOptionId;
}

const CHIP_PREFIX = "t3-choice://v1/";
const CHIP_LINK =
  /\[(\d{1,2})([A-HYN?])\]\(t3-choice:\/\/v1\/([^\s)/]{1,512})\/(\d{1,2})\/([^\s)/]{1,8})\)/g;

/** What the chip reads as, in the composer and in the sent message. */
export function choiceChipLabel(chip: Pick<ChoiceChip, "question" | "option">): string {
  return `${chip.question}${chip.option}`;
}

export function serializeChoiceChip(chip: ChoiceChip): string {
  return `[${choiceChipLabel(chip)}](${CHIP_PREFIX}${encodeURIComponent(chip.messageId)}/${chip.question}/${encodeURIComponent(chip.option)})`;
}

export function collectChoiceChips(
  text: string,
): { chip: ChoiceChip; source: string; start: number; end: number }[] {
  if (!text.includes(CHIP_PREFIX)) return [];
  const chips: { chip: ChoiceChip; source: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(CHIP_LINK)) {
    let messageId: string;
    let option: string;
    try {
      messageId = decodeURIComponent(match[3]!);
      option = decodeURIComponent(match[5]!);
    } catch {
      continue;
    }
    // The label is what the user reads; ignore links whose target disagrees with it.
    if (match[1] !== match[4] || match[2] !== option) continue;
    chips.push({
      chip: { messageId, question: Number(match[4]), option },
      source: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return chips;
}

/** Chips leave the composer as their label, so the agent and every client read `1Y 2B`. */
export function choiceChipsToPlainText(text: string): string {
  const chips = collectChoiceChips(text);
  if (chips.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const { chip, start, end } of chips) {
    result += text.slice(cursor, start) + choiceChipLabel(chip);
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** The option currently chosen for each question of one message, keyed by question number. */
export function chosenChoiceOptions(text: string, messageId: string): Map<number, ChoiceOptionId> {
  const chosen = new Map<number, ChoiceOptionId>();
  for (const { chip } of collectChoiceChips(text)) {
    if (chip.messageId === messageId) chosen.set(chip.question, chip.option);
  }
  return chosen;
}

/**
 * Tapping a button: picks the option, swaps it for the question's previous pick in place, or
 * removes it when it was already picked. Returns the range to replace, or `insert` for a new chip.
 */
export function planChoiceToggle(
  text: string,
  chip: ChoiceChip,
):
  | { kind: "insert"; source: string }
  | { kind: "replace"; start: number; end: number; source: string } {
  const existing = collectChoiceChips(text).find(
    (candidate) =>
      candidate.chip.messageId === chip.messageId && candidate.chip.question === chip.question,
  );
  const source = serializeChoiceChip(chip);
  if (!existing) return { kind: "insert", source };
  if (existing.chip.option !== chip.option) {
    return { kind: "replace", start: existing.start, end: existing.end, source };
  }
  // Removing: take one neighbouring space with the chip so words don't join or double up.
  let { start, end } = existing;
  if (text[end] === " ") end += 1;
  else if (text[start - 1] === " ") start -= 1;
  return { kind: "replace", start, end, source: "" };
}
