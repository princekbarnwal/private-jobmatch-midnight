/**
 * CLI for interacting with private-jobmatch-midnight contract
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import {
  resolveNetwork,
  getOrCreateWallet,
  formatWalletBackupNotice,
  getDeployment,
} from './network';

import {
  createWallet,
  persistWalletState,
  unshieldedToken,
  type WalletContext,
} from './wallet';

import {
  createJobMatchPrivateState,
  witnesses,
} from './witnesses.js';

(globalThis as any).WebSocket = WebSocket;

// Must match the private state ID used for this contract.
const PRIVATE_STATE_ID = 'jobMatchPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;

{
  const notice = formatWalletBackupNotice(WALLET, network);

  if (notice) {
    console.log(notice);
  }
}

const __dirname =
  path.dirname(fileURLToPath(import.meta.url));

const zkConfigPath =
  path.resolve(
    __dirname,
    '..',
    'contracts',
    'managed',
    'jobmatch',
  );

const contractPath =
  path.join(
    zkConfigPath,
    'contract',
    'index.js',
  );

if (!fs.existsSync(contractPath)) {
  console.error(
    '\n❌ Contract not compiled! Run: npm run compile\n',
  );

  process.exit(1);
}

// Load generated contract once.
const JobMatch = await import(
  pathToFileURL(contractPath).href,
);

let compiledContract: any = CompiledContract.make(
  'jobmatch',
  JobMatch.Contract as any,
) as any;

compiledContract = (CompiledContract.withWitnesses as any)(
  compiledContract,
  witnesses,
);

compiledContract = (CompiledContract.withCompiledFileAssets as any)(
  compiledContract,
  zkConfigPath,
);
// ─── Providers ────────────────────────────────────────────────

async function createProviders(
  walletCtx: WalletContext,
) {
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() ||
    'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () =>
      walletCtx.shieldedSecretKeys.coinPublicKey,

    getEncryptionPublicKey: () =>
      walletCtx.shieldedSecretKeys.encryptionPublicKey,

    async balanceTx(
      tx: any,
      ttl?: Date,
    ) {
      const recipe =
        await walletCtx.wallet.balanceUnboundTransaction(
          tx,
          {
            shieldedSecretKeys:
              walletCtx.shieldedSecretKeys,

            dustSecretKey:
              walletCtx.dustSecretKey,
          },
          {
            ttl:
              ttl ??
              new Date(
                Date.now() + 30 * 60 * 1000,
              ),
          },
        );

      return walletCtx.wallet.finalizeRecipe(
        recipe,
      );
    },

    submitTx: (tx: any) =>
      walletCtx.wallet.submitTransaction(
        tx,
      ) as any,
  };

  const zkConfigProvider =
    new NodeZkConfigProvider(
      zkConfigPath,
    );

  const accountId =
    walletCtx.unshieldedKeystore
      .getBech32Address()
      .toString();

  return {
    privateStateProvider:
      levelPrivateStateProvider({
        privateStateStoreName:
          'jobmatch-state',

        accountId,

        privateStoragePasswordProvider: () =>
          privateStatePassword,
      }),

    publicDataProvider:
      indexerPublicDataProvider(
        networkConfig.indexer,
        networkConfig.indexerWS,
      ),

    zkConfigProvider,

    proofProvider:
      httpClientProofProvider(
        networkConfig.proofServer,
        zkConfigProvider,
      ),

    walletProvider,

    midnightProvider:
      walletProvider,
  };
}

// ─── Main CLI ─────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              private-jobmatch-midnight CLI                  ║
╚══════════════════════════════════════════════════════════════╝
`);

  const rl =
    createInterface({
      input: stdin,
      output: stdout,
    });

  const deployment =
    getDeployment(network);

  if (!deployment) {
    console.error(
      `No deployment found for ${network}. Run npm run deploy first.`,
    );

    process.exit(1);
  }

  console.log(
    `  Contract: ${deployment.address}`,
  );

  console.log(
    `  Network: ${network}\n`,
  );

  try {
    console.log(
      '  Connecting to wallet...',
    );

    const walletCtx =
      await createWallet({
        network,
        networkConfig,
        seed: SEED,
      });

    const restoredCount =
      Object.values(walletCtx.restored)
        .filter(Boolean)
        .length;

    if (restoredCount > 0) {
      console.log(
        `  Restored ${restoredCount}/3 child wallets.`,
      );
    }

    console.log(
      '  Syncing with network...',
    );

    await walletCtx.wallet
      .waitForSyncedState();

    console.log(
      '  ✓ Synced with network.',
    );

    await persistWalletState(
      network,
      walletCtx,
    );

    const state =
      await walletCtx.wallet
        .waitForSyncedState();

    const balance =
      state.unshielded.balances[
        unshieldedToken().raw
      ] ?? 0n;

    console.log(
      `  Balance: ${balance.toLocaleString()} tNight\n`,
    );

    console.log(
      '  Connecting to contract...',
    );

    const providers =
      await createProviders(
        walletCtx,
      );

    providers.privateStateProvider
      .setContractAddress(
        deployment.address,
      );

    // Initial private state used only if the provider
    // does not already have state for this contract.
    const initialPrivateState =
      createJobMatchPrivateState(
        0n,
        false,
        false,
        0n,
      );

    const deployed: any =
      await findDeployedContract(
        providers as any,
        {
          compiledContract,
          contractAddress:
            deployment.address,

          privateStateId:
            PRIVATE_STATE_ID,

          initialPrivateState,
        },
      );

    console.log(
      '  ✅ Connected!\n',
    );

    let running = true;

    while (running) {
      console.log(`
─── JobMatch Menu ──────────────────────────────────────────────
  1. Set job requirements
  2. Set private candidate data
  3. Check private candidate match
  4. Read public job requirements
  5. Read latest match result
  6. Check wallet balance
  7. Exit
`);

      const choice =
        await rl.question(
          '  Your choice: ',
        );

      switch (choice.trim()) {

        // ────────────────────────────────────────────────
        // SET JOB REQUIREMENTS
        // ────────────────────────────────────────────────

        case '1': {
          const experience =
            await rl.question(
              '  Minimum experience (years): ',
            );

          const degree =
            await rl.question(
              '  Degree required? (y/n): ',
            );

          const javascript =
            await rl.question(
              '  JavaScript required? (y/n): ',
            );

          const salary =
            await rl.question(
              '  Maximum salary: ',
            );

          const minExperience =
            BigInt(experience);

          const requiresDegree =
            degree.trim()
              .toLowerCase() === 'y';

          const requiresJavaScript =
            javascript.trim()
              .toLowerCase() === 'y';

          const maxSalary =
            BigInt(salary);

          console.log(
            '\n  Submitting job requirements...',
          );

          try {
            const tx =
              await deployed.callTx
                .setJobRequirements(
                  minExperience,
                  requiresDegree,
                  requiresJavaScript,
                  maxSalary,
                );

            console.log(
              '\n  ✅ Job requirements saved.',
            );

            console.log(
              `  Transaction ID: ${tx.public.txId}\n`,
            );

            } catch (error) {
            console.error('\n❌ FULL ERROR:', error);

            if (error instanceof Error) {
              console.error('\n❌ STACK:', error.stack);
            }
          }

          break;
        }

        // ────────────────────────────────────────────────
        // PRIVATE CANDIDATE DATA
        // ────────────────────────────────────────────────

        case '2': {
          const experience =
            await rl.question(
              '  Candidate experience (years): ',
            );

          const degree =
            await rl.question(
              '  Has degree? (y/n): ',
            );

          const javascript =
            await rl.question(
              '  Knows JavaScript? (y/n): ',
            );

          const salary =
            await rl.question(
              '  Expected salary: ',
            );

          const privateState =
            createJobMatchPrivateState(
              BigInt(experience),

              degree.trim()
                .toLowerCase() === 'y',

              javascript.trim()
                .toLowerCase() === 'y',

              BigInt(salary),
            );

          await providers
            .privateStateProvider
            .set(
              PRIVATE_STATE_ID,
              privateState,
            );

          console.log(
            '\n  ✅ Candidate data saved privately.',
          );

          console.log(
            '  It is not written to the public ledger.\n',
          );

          break;
        }

        // ────────────────────────────────────────────────
        // CHECK MATCH
        // ────────────────────────────────────────────────

        case '3': {
          console.log(
            '\n  Checking candidate against job...',
          );

          try {
            const tx =
              await deployed.callTx
                .checkMatch();

            console.log(
              '\n  ✅ Match proof generated and submitted.',
            );

            console.log(
              `  Transaction ID: ${tx.public.txId}\n`,
            );

          } catch (error) {
            console.error(
              '\n  ❌ Match failed:',
              error instanceof Error
                ? error.message
                : error,
            );
          }

          break;
        }

        // ────────────────────────────────────────────────
        // PUBLIC JOB REQUIREMENTS
        // ────────────────────────────────────────────────

        case '4': {
          console.log(
            '\n  Reading public job requirements...',
          );

          try {
            const contractState =
              await providers
                .publicDataProvider
                .queryContractState(
                  deployment.address,
                );
                
            if (!contractState) {
              console.log(
                '\n  No contract state found.\n',
              );

              break;
            }

            const ledger =
              JobMatch.ledger(
                contractState.data,
              );

            console.log(`
  Minimum experience: ${ledger.minimumExperience}
  Degree required: ${ledger.degreeRequired}
  JavaScript required: ${ledger.javascriptRequired}
  Maximum salary: ${ledger.maximumSalary}
`);

          } catch (error) {
            console.error(
              '\n  ❌ Failed:',
              error instanceof Error
                ? error.message
                : error,
            );
          }

          break;
        }

        // ────────────────────────────────────────────────
        // LAST MATCH
        // ────────────────────────────────────────────────

        case '5': {
          console.log(
            '\n  Reading latest match result...',
          );

          try {
            const contractState =
              await providers
                .publicDataProvider
                .queryContractState(
                  deployment.address,
                );

            if (!contractState) {
              console.log(
                '\n  No contract state found.\n',
              );

              break;
            }

            const ledger =
              JobMatch.ledger(
                contractState.data,
              );

            console.log(
              `\n  Last match: ${ledger.lastMatch}\n`,
            );

          } catch (error) {
            console.error(
              '\n  ❌ Failed:',
              error instanceof Error
                ? error.message
                : error,
            );
          }

          break;
        }

        // ────────────────────────────────────────────────
        // BALANCE
        // ────────────────────────────────────────────────

        case '6': {
          const currentState =
            await walletCtx.wallet
              .waitForSyncedState();

          const currentBalance =
            currentState.unshielded.balances[
              unshieldedToken().raw
            ] ?? 0n;

          const dustBalance =
            currentState.dust.balance(
              new Date(),
            );

          console.log(`
  tNight: ${currentBalance.toLocaleString()}
  DUST: ${dustBalance.toLocaleString()}
`);

          break;
        }

        // ────────────────────────────────────────────────
        // EXIT
        // ────────────────────────────────────────────────

        case '7':
          running = false;

          console.log(
            '\n  👋 Goodbye!\n',
          );

          break;

        default:
          console.log(
            '\n  ❌ Invalid choice. Enter 1-7.\n',
          );
      }
    }

    await persistWalletState(
      network,
      walletCtx,
    );

    await walletCtx.wallet.stop();

  } catch (error) {
    console.error(
      '\n❌ Error:',
      error instanceof Error
        ? error.message
        : error,
    );

  } finally {
    rl.close();
  }
}

main().catch(console.error);