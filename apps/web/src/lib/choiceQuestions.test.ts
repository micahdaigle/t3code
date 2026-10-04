import { describe, expect, it } from "vite-plus/test";

import {
  choiceChipsToPlainText,
  chosenChoiceOptions,
  collectChoiceChips,
  parseChoiceQuestions,
  planChoiceToggle,
  serializeChoiceChip,
} from "./choiceQuestions";

const DIGEST_STYLE = `# Status
Done.

# Questions

**1. Merge now?** **(Y★)**
- Context, if any, as bullets right under the question.

**2. Pick a color:**
- **A. Blue.** Short description.
- **B. Green.** Short description. **(★)**

**3. Anything else you want changed?**

Thanks!`;

describe("parseChoiceQuestions", () => {
  it("reads yes/no, lettered, and open questions under a Questions heading", () => {
    const questions = parseChoiceQuestions(DIGEST_STYLE);
    expect(
      questions.map(({ number, text, kind, options }) => ({ number, text, kind, options })),
    ).toEqual([
      {
        number: 1,
        text: "Merge now?",
        kind: "yes-no",
        options: [
          { id: "Y", label: "Yes", recommended: true },
          { id: "N", label: "No", recommended: false },
        ],
      },
      {
        number: 2,
        text: "Pick a color:",
        kind: "options",
        options: [
          { id: "A", label: "Blue", recommended: false },
          { id: "B", label: "Green", recommended: true },
        ],
      },
      { number: 3, text: "Anything else you want changed?", kind: "open", options: [] },
    ]);
  });

  it("places each question's buttons after its last attached line", () => {
    const [first, second, third] = parseChoiceQuestions(DIGEST_STYLE);
    expect(DIGEST_STYLE.slice(0, first!.end).endsWith("right under the question.")).toBe(true);
    expect(DIGEST_STYLE.slice(0, second!.end).endsWith("Short description. **(★)**")).toBe(true);
    expect(DIGEST_STYLE.slice(0, third!.end).endsWith("want changed?**")).toBe(true);
  });

  it("ignores numbered bold steps outside a Questions section unless they offer choices", () => {
    const markdown = `Here is the plan:

**1. Install dependencies.**
**2. Run the build.**

**3. Ship it?** (Y/N)`;
    const questions = parseChoiceQuestions(markdown);
    expect(questions.map((question) => [question.number, question.kind])).toEqual([[3, "yes-no"]]);
    expect(questions[0]!.options.every((option) => !option.recommended)).toBe(true);
  });

  it("reads options outside a Questions section", () => {
    const markdown = `**4. Which database?**
- A. Postgres. Mature and boring.
- B. SQLite (Recommended)`;
    expect(parseChoiceQuestions(markdown)[0]).toMatchObject({
      number: 4,
      kind: "options",
      options: [
        { id: "A", label: "Postgres", recommended: false },
        { id: "B", label: "SQLite", recommended: true },
      ],
    });
  });

  it("accepts a recommended no and the marker inside the bold text", () => {
    expect(parseChoiceQuestions("**1. Delete the branch? (N★)**")[0]!.options).toEqual([
      { id: "Y", label: "Yes", recommended: false },
      { id: "N", label: "No", recommended: true },
    ]);
  });

  it("reads plain numbered lists and bold-number lines inside a Questions section", () => {
    const markdown = `## Questions
1. Keep the old API? (Y★)
2. Rename it to what?

**3.** Ship today? (Y/N)

## Notes
1. Not a question.`;
    expect(
      parseChoiceQuestions(markdown).map((question) => [question.number, question.kind]),
    ).toEqual([
      [1, "yes-no"],
      [2, "open"],
      [3, "yes-no"],
    ]);
  });

  it("skips fenced code and lettered runs that do not start at A", () => {
    const markdown = `# Questions
\`\`\`md
**1. Not real?** (Y/N)
\`\`\`

**2. Roman numerals:**
- I. First
- V. Fifth`;
    expect(
      parseChoiceQuestions(markdown).map((question) => [question.number, question.kind]),
    ).toEqual([[2, "open"]]);
  });

  it("keeps only the first question with a given number", () => {
    const markdown = `**1. First? (Y/N)**\n\n**1. Again? (Y/N)**`;
    expect(parseChoiceQuestions(markdown).map((question) => question.text)).toEqual(["First?"]);
  });

  it("returns nothing for ordinary prose", () => {
    expect(parseChoiceQuestions("Just a normal **bold** answer.\n\n1. one\n2. two")).toEqual([]);
  });
});

describe("choice chips", () => {
  const chip = { messageId: "msg/1 two", question: 2, option: "B" };

  it("round-trips through the composer text", () => {
    const source = serializeChoiceChip(chip);
    expect(collectChoiceChips(`before ${source} after`)).toEqual([
      { chip, source, start: 7, end: 7 + source.length },
    ]);
  });

  it("encodes the explain option", () => {
    const explain = { ...chip, option: "?" };
    expect(collectChoiceChips(serializeChoiceChip(explain))[0]!.chip).toEqual(explain);
    expect(choiceChipsToPlainText(serializeChoiceChip(explain))).toBe("2?");
  });

  it("ignores links whose label disagrees with the target", () => {
    expect(collectChoiceChips("[2A](t3-choice://v1/m/2/B)")).toEqual([]);
  });

  it("sends as the plain label", () => {
    const text = `${serializeChoiceChip({ messageId: "m", question: 1, option: "Y" })} ${serializeChoiceChip({ messageId: "m", question: 2, option: "B" })} but use teal`;
    expect(choiceChipsToPlainText(text)).toBe("1Y 2B but use teal");
  });

  it("reports the chosen options for one message only", () => {
    const text = `${serializeChoiceChip({ messageId: "m", question: 1, option: "Y" })} ${serializeChoiceChip({ messageId: "other", question: 2, option: "B" })}`;
    expect([...chosenChoiceOptions(text, "m")]).toEqual([[1, "Y"]]);
  });

  it("inserts, swaps in place, and removes on a second tap", () => {
    const a = serializeChoiceChip({ ...chip, option: "A" });
    expect(planChoiceToggle("hi", chip)).toEqual({
      kind: "insert",
      source: serializeChoiceChip(chip),
    });
    expect(planChoiceToggle(`x ${a} y`, chip)).toEqual({
      kind: "replace",
      start: 2,
      end: 2 + a.length,
      source: serializeChoiceChip(chip),
    });
    const b = serializeChoiceChip(chip);
    const removal = planChoiceToggle(`x ${b} y`, chip);
    expect(removal).toEqual({ kind: "replace", start: 2, end: 3 + b.length, source: "" });
  });
});
