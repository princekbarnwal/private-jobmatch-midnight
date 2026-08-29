import type { Ledger, Witnesses } from '../contracts/managed/jobmatch/contract/index.js';

export type JobMatchPrivateState = {
  experience: bigint;
  hasDegree: boolean;
  hasJavaScript: boolean;
  expectedSalary: bigint;
};

export const createJobMatchPrivateState = (
  experience: bigint,
  hasDegree: boolean,
  hasJavaScript: boolean,
  expectedSalary: bigint,
): JobMatchPrivateState => ({
  experience,
  hasDegree,
  hasJavaScript,
  expectedSalary,
});

export const witnesses: Witnesses<JobMatchPrivateState> = {
  getExperience: ({ privateState }) => [
    privateState,
    privateState.experience,
  ],

  getHasDegree: ({ privateState }) => [
    privateState,
    privateState.hasDegree,
  ],

  getHasJavaScript: ({ privateState }) => [
    privateState,
    privateState.hasJavaScript,
  ],

  getExpectedSalary: ({ privateState }) => [
    privateState,
    privateState.expectedSalary,
  ],
};