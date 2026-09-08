import { computeAverages } from 'logfire/evals';
import type { EvaluationReport, ReportCase, ReportCaseAggregate } from 'logfire/evals';

/**
 * The per-intent / per-locale view of a run (#1327 AC 2, W3-5's second ask).
 *
 * WHERE THE TWO DIMENSIONS COME FROM. Python does not aggregate by either one;
 * what it does is write them onto every per-case row —
 * `results_payload.CaseRow.intent = _output_intent(output)`, read off the
 * `AgentResult` the turn produced, and `CaseRow.locale = _input_locale(inputs)`,
 * the locale the case ASKED for — both written by `report_case_rows`. This
 * groups by exactly those two facts:
 * `TranscriptResult.intent` is the wire twin of the first (`turn-transcript.ts`),
 * and `ExportedAgentInput.locale` is literally the second. There is no
 * `metadata.intent` to read — `AgentExpected` carries acceptable stages, data
 * keys and a nonempty flag, and nothing about what the turn actually did.
 *
 * WHY `computeAverages` AND NOT A MEAN OF MY OWN. It is the same function
 * `averages(report)` uses for the run's headline scores, so a group's numbers
 * are computed the way the run's own are — including the part that is easy to
 * get wrong: a metric only some cases carry (`nonempty_results`, which is `{}`
 * on an untagged case) averages over the cases that HAVE it, and the `count`
 * beside each mean is how many those were.
 *
 * ERRORED CASES ARE NOT HERE. They have no output to read an intent off and no
 * scores to average; they are counted by the error-rate gate, which is the one
 * place a run's failures are supposed to show up.
 */

/** One group's size and its per-metric aggregate, straight from `computeAverages`. */
export interface BreakdownGroup {
  readonly cases: number;
  readonly scores: ReportCaseAggregate['scores'];
}

export interface ScoreBreakdown {
  readonly by_intent: Readonly<Record<string, BreakdownGroup>>;
  readonly by_locale: Readonly<Record<string, BreakdownGroup>>;
}

/** The one member of the case inputs this view reads. */
interface LocaleAsked {
  readonly locale: string;
}

/** The one member of the turn output this view reads. */
interface IntentAnswered {
  readonly intent: string;
}

export function scoreBreakdownOf<Inputs extends LocaleAsked, Output extends IntentAnswered>(
  report: EvaluationReport<Inputs, Output>,
): ScoreBreakdown {
  return {
    by_intent: groupedScores(report.cases, (entry) => entry.output.intent),
    by_locale: groupedScores(report.cases, (entry) => entry.inputs.locale),
  };
}

type Facet<Inputs, Output> = (entry: ReportCase<Inputs, Output>) => string;

/** Group names sort, so a committed result file diffs by content and not by
 * the order the cases happened to finish in. */
function groupedScores<Inputs, Output>(
  cases: readonly ReportCase<Inputs, Output>[],
  facet: Facet<Inputs, Output>,
): Record<string, BreakdownGroup> {
  const groups = groupedCases(cases, facet);
  const names = [...groups.keys()].sort();
  return Object.fromEntries(
    names.map((name) => [name, breakdownGroup(name, groups.get(name) ?? [])]),
  );
}

function groupedCases<Inputs, Output>(
  cases: readonly ReportCase<Inputs, Output>[],
  facet: Facet<Inputs, Output>,
): Map<string, ReportCase<Inputs, Output>[]> {
  const groups = new Map<string, ReportCase<Inputs, Output>[]>();
  for (const entry of cases) {
    const name = facet(entry);
    groups.set(name, [...(groups.get(name) ?? []), entry]);
  }
  return groups;
}

function breakdownGroup<Inputs, Output>(
  name: string,
  entries: readonly ReportCase<Inputs, Output>[],
): BreakdownGroup {
  return { cases: entries.length, scores: computeAverages(name, entries).scores };
}
