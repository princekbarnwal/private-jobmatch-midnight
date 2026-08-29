import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  getExperience(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  getHasDegree(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, boolean];
  getHasJavaScript(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, boolean];
  getExpectedSalary(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  setJobRequirements(context: __compactRuntime.CircuitContext<PS>,
                     minExperience_0: bigint,
                     requiresDegree_0: boolean,
                     requiresJavaScript_0: boolean,
                     maxSalary_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  checkMatch(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  setJobRequirements(context: __compactRuntime.CircuitContext<PS>,
                     minExperience_0: bigint,
                     requiresDegree_0: boolean,
                     requiresJavaScript_0: boolean,
                     maxSalary_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  checkMatch(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  setJobRequirements(context: __compactRuntime.CircuitContext<PS>,
                     minExperience_0: bigint,
                     requiresDegree_0: boolean,
                     requiresJavaScript_0: boolean,
                     maxSalary_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  checkMatch(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly minimumExperience: bigint;
  readonly degreeRequired: boolean;
  readonly javascriptRequired: boolean;
  readonly maximumSalary: bigint;
  readonly lastMatch: boolean;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
