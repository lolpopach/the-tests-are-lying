import { assertionDeleted, tautologicalAssertion, testDeleted, thresholdLoosened } from './gutted.js';
import {
  testSkipped, errorSuppressed, errorSwallowed, subjectMocked, ciAlwaysPasses,
} from './silenced.js';

/**
 * Every way a diff can make the checks easier instead of making the code
 * right, ordered by how completely the green light stops meaning anything.
 */
export const RULES = [
  testDeleted,
  assertionDeleted,
  tautologicalAssertion,
  subjectMocked,
  ciAlwaysPasses,
  testSkipped,
  errorSwallowed,
  errorSuppressed,
  thresholdLoosened,
];

export const RULE_IDS = RULES.map((r) => r.id);
