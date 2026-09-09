import assert from 'node:assert/strict';
import {
  Case, Dataset, Evaluator, ReportEvaluator, MaxDuration,
  caseGroups, renderReport, setEvalAttribute,
} from 'logfire/evals';

// Original native ESM probe, with public imports and stdout instead of local paths.
class RequiredQuality extends Evaluator {
  evaluate() {
    return false;
  }
}

class MissingQuality extends Evaluator {
  evaluate() {
    return {};
  }
}

class NativeAnalysis extends ReportEvaluator {
  evaluate({ report }) {
    return { type: 'scalar', title: 'completed', value: report.cases.length };
  }
}

const dataset = new Dataset({
  name: 'native-contract-probe', cases: [new Case({ name: 'quality', inputs: 'x' })],
  evaluators: [new RequiredQuality(), new MissingQuality(), new MaxDuration({ seconds: 60 })],
  reportEvaluators: [new NativeAnalysis()],
});
const report = await dataset.evaluate(async () => {
  setEvalAttribute('nativeProbe', true);
  return 'output';
}, { repeat: 2, maxConcurrency: 1 });
let calls = 0;
const failing = await new Dataset({
  name: 'failure-probe', cases: [new Case({ name: 'throws', inputs: 'x' })],
}).evaluate(async () => {
  calls += 1;
  throw new Error('probe failure');
}, { repeat: 2, maxConcurrency: 1, retryTask: { retries: 0 } });

// Assert the recorded structural outcomes; timings are observations, not thresholds.
assert.equal(caseGroups(report)[0].runs.length, 2);
assert.equal(caseGroups(failing)[0].failures.length, 2);
assert.equal(calls, 2);
assert.deepEqual(report.analyses, [{ type: 'scalar', title: 'completed', value: 2 }]);
for (const result of report.cases) {
  assert.deepEqual(Object.keys(result.assertions).sort(), ['MaxDuration', 'RequiredQuality']);
  assert.equal(result.assertions.RequiredQuality.value, false);
  assert.equal(result.attributes.nativeProbe, true);
}
assert.equal(typeof renderReport(report), 'string');
assert.equal(typeof report.toFile, 'undefined');
console.log(JSON.stringify({
  version: '0.22.5', report, groups: caseGroups(report), failureGroups: caseGroups(failing),
  taskInvocations: calls, renderIsString: typeof renderReport(report) === 'string',
  reportToFile: typeof report.toFile,
}, null, 2));
