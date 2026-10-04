import { CircleHelpIcon, ListChecksIcon, StarIcon } from "lucide-react";
import { createContext, Fragment, use, useMemo, type ReactNode } from "react";

import { useComposerDraftStore, type ComposerThreadTarget } from "~/composerDraftStore";
import {
  CHOICE_EXPLAIN_OPTION,
  canSplitChoiceMarkdown,
  choiceChipLabel,
  chosenChoiceOption,
  parseChoiceQuestions,
  type ChoiceChip as ChoiceChipValue,
  type ChoiceQuestion,
} from "~/lib/choiceQuestions";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Supplied by the chat view that owns the composer. Without it (read-only timelines), assistant
 * messages render exactly as before, with no buttons.
 */
export const ChoiceQuestionsContext = createContext<{
  draftTarget: ComposerThreadTarget;
  toggleChoice: (chip: ChoiceChipValue) => void;
} | null>(null);

/** The composer pill for one reply, such as `2B`. */
export function ChoiceChip({ chip }: { chip: ChoiceChipValue }) {
  const explain = chip.option === CHOICE_EXPLAIN_OPTION;
  const label = choiceChipLabel(chip);
  return (
    <ContextChip
      kind="choice"
      contentEditable={false}
      data-markdown-copy={label}
      aria-label={explain ? `Explain question ${chip.question}` : `Answer ${label}`}
    >
      {explain ? <CircleHelpIcon aria-hidden="true" /> : <ListChecksIcon aria-hidden="true" />}
      <ContextChipLabel>{label}</ContextChipLabel>
    </ContextChip>
  );
}

/**
 * Renders an assistant message with a row of reply buttons under each question it asks. Messages
 * without questions, and messages still streaming, go through `renderMarkdown` untouched. The
 * first piece keeps one key in every state, so finishing a stream updates the rendered markdown
 * instead of remounting it.
 */
export function ChoiceQuestionMarkdown({
  text,
  messageId,
  isStreaming,
  renderMarkdown,
}: {
  text: string;
  messageId: string;
  isStreaming: boolean;
  renderMarkdown: (text: string) => ReactNode;
}) {
  const hasChoices = use(ChoiceQuestionsContext) !== null;
  const layout = useMemo(() => {
    const questions = hasChoices && !isStreaming ? parseChoiceQuestions(text) : [];
    return { questions, inline: questions.length > 0 && canSplitChoiceMarkdown(text) };
  }, [hasChoices, isStreaming, text]);

  if (!layout.inline) {
    return [
      <Fragment key="chunk-0">{renderMarkdown(text)}</Fragment>,
      ...layout.questions.map((question) => (
        <ChoiceQuestionRow
          key={`row-${question.number}`}
          messageId={messageId}
          question={question}
          showNumber
        />
      )),
    ];
  }

  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const question of layout.questions) {
    const chunk = text.slice(cursor, question.end);
    if (chunk.trim()) {
      pieces.push(<Fragment key={`chunk-${cursor}`}>{renderMarkdown(chunk)}</Fragment>);
    }
    pieces.push(
      <ChoiceQuestionRow
        key={`row-${question.number}`}
        messageId={messageId}
        question={question}
      />,
    );
    cursor = question.end;
  }
  const rest = text.slice(cursor);
  if (rest.trim()) pieces.push(<Fragment key={`chunk-${cursor}`}>{renderMarkdown(rest)}</Fragment>);
  return pieces;
}

function ChoiceQuestionRow({
  messageId,
  question,
  showNumber = false,
}: {
  messageId: string;
  question: ChoiceQuestion;
  /** Rows gathered under the message, away from their question, say which one they answer. */
  showNumber?: boolean;
}) {
  const choices = use(ChoiceQuestionsContext)!;
  // A primitive selection, so typing in the composer only re-renders rows whose pick changed.
  const chosen = useComposerDraftStore((store) =>
    chosenChoiceOption(
      store.getComposerDraft(choices.draftTarget)?.prompt ?? "",
      messageId,
      question.number,
    ),
  );
  const toggle = (option: string) =>
    choices.toggleChoice({ messageId, question: question.number, option });
  const explainChosen = chosen === CHOICE_EXPLAIN_OPTION;

  return (
    <div
      role="group"
      aria-label={`Reply to question ${question.number}`}
      className="my-2 flex flex-wrap items-center gap-1.5 select-none"
    >
      {showNumber ? (
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {question.number}.
        </span>
      ) : null}
      {question.options.map((option) => {
        const selected = chosen === option.id;
        return (
          <Button
            key={option.id}
            type="button"
            size="sm-multiline"
            variant={selected ? "default" : option.recommended ? "warning-outline" : "outline"}
            aria-pressed={selected}
            onClick={() => toggle(option.id)}
          >
            {option.recommended ? <StarIcon aria-label="Recommended" /> : null}
            {question.kind === "options" ? `${option.id} · ${option.label}` : option.label}
          </Button>
        );
      })}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="sm-multiline"
              variant={explainChosen ? "default" : "ghost-muted"}
              aria-pressed={explainChosen}
              aria-label={`Ask to explain question ${question.number}`}
              onClick={() => toggle(CHOICE_EXPLAIN_OPTION)}
            />
          }
        >
          <CircleHelpIcon aria-hidden="true" />
          {question.options.length === 0 ? "Explain" : null}
        </TooltipTrigger>
        <TooltipPopup side="top">Ask to explain question {question.number}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
