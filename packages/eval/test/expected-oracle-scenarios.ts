/**
 * The scenario set the committed oracles must carry, written down by hand
 * (#1463).
 *
 * `evaluator-parity.test.ts` and the `gate-*.test.ts` files generate one test
 * per oracle entry. A scenario deleted from its Python producer and re-exported
 * therefore takes its own test away with it, and the suite stays green — the
 * one hole in exactly the guard that exists to catch Python/TS divergence.
 *
 * This list is the second witness, and it is deliberately NOT derived from the
 * fixtures: `oracle-scenario-pin.test.ts` compares it against what the fixtures
 * actually carry and names the id that disappeared. A pin exported alongside
 * the scenarios would move with them and prove nothing.
 *
 * **Adding or removing a scenario is a two-file change by design** — the Python
 * producer (`evaluator_oracle_cases.py`, `gate_oracle.py`, `strata_oracle.py`,
 * `stats_oracle.py`), then this list — after which
 * `bash packages/eval/scripts/export-fixtures.sh` re-exports and the drift gate
 * agrees.
 */

/** The named case lists `stats_oracle.py` writes, one generated test each. */
export type StatsOracleList =
  | 'baseline_staleness'
  | 'bootstrap_gates'
  | 'case_strata'
  | 'error_rate_gates'
  | 'paired_comparisons'
  | 'provider_outage_gates';

/** The same file's anonymous rows, which carry no name to pin. */
export type StatsOracleRowList =
  | 'baseline_paths'
  | 'clopper_pearson_intervals'
  | 'number_text.fixed_4'
  | 'number_text.percent_0'
  | 'number_text.repr'
  | 'proportion_comparisons'
  | 'random_stream.choice_of_five'
  | 'random_stream.choice_of_one'
  | 'random_stream.choice_of_two'
  | 'random_stream.getrandbits_32'
  | 'written_records';

/** `evaluator_oracle_cases.py::SCENARIOS` — one parity test per id. */
export const EVALUATOR_ORACLE_SCENARIOS: readonly string[] = [
  'search_bangumi_exact_chain',
  'general_qa_any_of_n_web_search',
  'clarify_any_of_n_tie_partial',
  'point_selection_empty_chain',
  'point_selection_published_step',
  'candidate_selection_min_steps',
  'candidate_selection_published_step',
  'place_ambiguity_min_steps',
  'clarify_after_nearby_geocode_min_steps',
  'greet_user_no_steps',
  'empty_message_locale_zero',
  'reply_language_mismatch',
  'simplified_hint_locale',
  'han_only_query_falls_back',
  'unknown_stage_defaults',
  'failed_step_excluded_from_chain',
  'unsettled_call_excluded_from_chain',
  'repeated_tool_call',
  'empty_arguments_still_score',
  'itinerary_without_source',
  'search_present_but_zero_rows',
  'settled_params_coerced_from_raw_arguments',
  'settled_params_dropped_an_optional_null',
  'place_selection_calls_the_stage_it_names',
  'place_selection_refused_to_act',
  'clarify_without_pending',
];

/**
 * `stats_oracle.py`'s named cases — one or two generated gate tests per id.
 * `case_strata` is `strata_oracle.py`'s; the rest are `gate_oracle.py`'s.
 */
export const STATS_ORACLE_SCENARIOS: Readonly<Record<StatsOracleList, readonly string[]>> = {
  baseline_staleness: [
    'fresh',
    'no_expectations',
    'case_count_changed',
    'evaluated_count_low',
    'metric_vocabulary_changed',
  ],
  bootstrap_gates: ['indeterminate', 'few_pairs', 'real_baseline_subset'],
  // One id set for both `gate-case-strata.test.ts` loops: the entries Python
  // loaded (`strata !== null`) and the ones it refused (`strata === null`) are
  // partitions of this list, so a drop from either goes red here (#1488).
  case_strata: [
    'path_column',
    'no_path_column',
    'partial_path_column',
    'non_string_path',
    'row_without_id',
    'pooled_row_without_id',
    'not_a_list',
    'invalid_json',
    'empty_set',
  ],
  error_rate_gates: [
    'over_ceiling',
    'empty_run',
    'at_ceiling_regression',
    'no_baseline',
    'empty_baseline',
    'steady',
  ],
  provider_outage_gates: ['total_outage', 'over_ceiling', 'at_ceiling', 'empty_run'],
  paired_comparisons: [
    'clear_regression',
    'clear_improvement',
    'no_change',
    'overlap',
    'rare_stratum_regression',
    'graded',
  ],
};

/**
 * The row counts the anonymous lists must keep. Python names none of these
 * rows — they are `(events, total)` pairs, float literals and raw MT19937
 * draws — so the pin is the count rather than an id set. `random_stream`'s
 * four belong here for the same reason under a different shape:
 * `gate-python-random.test.ts` sizes its own draws from `<list>.length`, so a
 * truncated list shortens both sides of its deep-equal and still passes.
 */
export const STATS_ORACLE_ROW_COUNTS: Readonly<Record<StatsOracleRowList, number>> = {
  baseline_paths: 2,
  clopper_pearson_intervals: 7,
  'number_text.fixed_4': 14,
  'number_text.percent_0': 9,
  'number_text.repr': 13,
  proportion_comparisons: 4,
  'random_stream.choice_of_five': 16,
  'random_stream.choice_of_one': 4,
  'random_stream.choice_of_two': 16,
  'random_stream.getrandbits_32': 8,
  written_records: 4,
};
