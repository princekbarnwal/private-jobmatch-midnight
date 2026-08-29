/**
 * Deploy private-jobmatch-midnight contract to a Midnight network.
 */
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import {
  resolveNetwork,
  getOrCreateWallet,
  formatWalletBackupNotice,
  recordDeployment,
} from './network';

import {
  createWallet,
  persistWalletState,
  unshieldedToken,
  type WalletContext,
} from './wallet';

import {
  witnesses,
  createJobMatchPrivateState,
} from './witnesses.js';

(globalThis as any).WebSocket = WebSocket;

// Must match cli.ts.
const PRIVATE_STATE_ID = 'jobMatchPrivateState';

const {
  network,
  config: networkConfig,
} = resolveNetwork();

const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;

{
  const notice =
    formatWalletBackupNotice(
      WALLET,
      network,
    );

  if (notice) {
    console.log(notice);
  }
}

// ─── Proof Server ─────────────────────────────────────────────

async function waitForProofServer(
  maxAttempts = 60,
  delayMs = 2000,
): Promise<boolean> {
  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      await fetch(
        networkConfig.proofServer,
        {
          method: 'GET',
          signal:
            AbortSignal.timeout(3000),
        },
      );

      return true;

    } catch (err: any) {
      const code =
        err?.cause?.code ||
        err?.code ||
        '';

      if (
        code !== 'ECONNREFUSED' &&
        code !== 'UND_ERR_CONNECT_TIMEOUT' &&
        code !== 'UND_ERR_SOCKET'
      ) {
        return true;
      }
    }

    if (attempt < maxAttempts) {
      process.stdout.write(
        `\r  Waiting for proof server... (${attempt}/${maxAttempts})   `,
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            delayMs,
          ),
      );
    }
  }

  return false;
}

// ─── Compiled Contract ────────────────────────────────────────

const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url),
  );

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
      walletCtx.shieldedSecretKeys
        .coinPublicKey,

    getEncryptionPublicKey: () =>
      walletCtx.shieldedSecretKeys
        .encryptionPublicKey,

    async balanceTx(
      tx: any,
      ttl?: Date,
    ) {
      const recipe =
        await walletCtx.wallet
          .balanceUnboundTransaction(
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
                  Date.now() +
                    30 * 60 * 1000,
                ),
            },
          );

      return walletCtx.wallet
        .finalizeRecipe(recipe);
    },

    submitTx: (tx: any) =>
      walletCtx.wallet
        .submitTransaction(tx) as any,
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

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        private-jobmatch-midnight Deployment                 ║
╚══════════════════════════════════════════════════════════════╝
`);

  console.log(
    `  Network: ${network}`,
  );

  try {
    console.log(
      '\n  Connecting to wallet...',
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
      `  Balance: ${balance.toLocaleString()} tNight`,
    );

    console.log(
      '\n  Connecting to proof server...',
    );

    const proofServerReady =
      await waitForProofServer();

    if (!proofServerReady) {
      throw new Error(
        'Proof server is not reachable.',
      );
    }

    console.log(
      '\n  ✓ Proof server ready.',
    );

    console.log(
      '\n  Creating providers...',
    );

    const providers =
      await createProviders(
        walletCtx,
      );

    // Initial private state for the contract.
    const initialPrivateState =
      createJobMatchPrivateState(
        0n,
        false,
        false,
        0n,
      );

    console.log(
      '\n  Deploying contract...',
    );

    const deployed: any =
      await deployContract(
  providers as any,
  {
    compiledContract,
    args: [],
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  } as any,
);

    

const contractAddress =
  deployed.deployTxData.public.contractAddress;

console.log(
  `\n  Contract address: ${contractAddress}`,
);

    console.log(
      '\n  ✅ Contract deployed successfully!',
    );

    console.log(
      `\n  Contract address: ${contractAddress}`,
    );

    recordDeployment(
  network,
  contractAddress,
  walletCtx.unshieldedKeystore
    .getBech32Address()
    .toString(),
);

    await persistWalletState(
      network,
      walletCtx,
    );

    console.log(
      '\n  Deployment saved.',
    );

    await walletCtx.wallet.stop();

  } catch (error) {
    console.error(
      '\n❌ Deployment failed:',
      error instanceof Error
        ? error.message
        : error,
    );

    process.exitCode = 1;
  }
}

main().catch(console.error);