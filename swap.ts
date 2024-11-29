import { VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import axios from 'axios';
import { connection, owner, fetchTokenAccountData } from './config';
import { API_URLS } from '@raydium-io/raydium-sdk-v2';

export const ERROR_INPUT_TOKEN_ACCOUNT_NOT_FOUND = new Error('Input token account not found');
export const ERROR_GET_PRIORITY_FEE_FAILED = new Error('Get priority fee failed');
export const ERROR_COMPUTE_SWAP_FAILED = new Error('Compute swap failed');
export const ERROR_OUTPUT_AMOUNT_TOO_LOW = new Error('Output amount too low');
export const ERROR_TRANSACTION_FAILED = new Error('Transaction failed');

interface SwapCompute {
  id: string
  success: true
  version: 'V0' | 'V1'
  openTime?: undefined
  msg: undefined
  data: {
    swapType: 'BaseIn' | 'BaseOut'
    inputMint: string
    inputAmount: string
    outputMint: string
    outputAmount: string
    otherAmountThreshold: string
    slippageBps: number
    priceImpactPct: number
    routePlan: {
      poolId: string
      inputMint: string
      outputMint: string
      feeMint: string
      feeRate: number
      feeAmount: string
    }[]
  }
}

export const apiSwap = async (inputMint: string, outputMint: string, amount: number) => {
  const slippage = 0.5; // in percent, for this example, 0.5 means 0.5%
  const txVersion: string = 'V0'; // or LEGACY

  const [isInputSol, isOutputSol] = [
    inputMint === NATIVE_MINT.toBase58(),
    outputMint === NATIVE_MINT.toBase58(),
  ];

  const { tokenAccounts } = await fetchTokenAccountData();
  const inputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === inputMint);
  const outputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === outputMint);
  const inputTokenPublicKey = inputTokenAcc?.publicKey;
  const outputTokenPublicKey = outputTokenAcc?.publicKey;

  if (!inputTokenPublicKey && !isInputSol) {
    throw ERROR_INPUT_TOKEN_ACCOUNT_NOT_FOUND;
  }

  if (amount > inputTokenAcc?.amount && !isInputSol) {
    amount = inputTokenAcc?.amount.toNumber();
    console.info('Input token amount exceed, set to max amount:', amount);
  }

  // get statistical transaction fee from api
  /**
   * vh: very high
   * h: high
   * m: medium
   */
  const { data } = await axios.get<{
    id: string
    success: boolean
    data: { default: { vh: number; h: number; m: number } }
  }>(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);

  if (!data.success) {
    throw ERROR_GET_PRIORITY_FEE_FAILED;
  }

  const { data: swapResponse } = await axios.get<SwapCompute>(
    `${
      API_URLS.SWAP_HOST
    }/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${
      amount
    }&slippageBps=${
      slippage * 100
    }&txVersion=${txVersion}`,
  );

  if (!swapResponse.success) {
    console.error('Compute swap failed, msg:', swapResponse.msg);
    throw ERROR_COMPUTE_SWAP_FAILED;
  }

  const outputAmount = parseInt(swapResponse.data.outputAmount);
  if (outputAmount < 0.01 * 1_000_000_000) {
    console.error(`Output amount too low: ${outputAmount / 1_000_000_000} SOL`);
    throw ERROR_OUTPUT_AMOUNT_TOO_LOW;
  }

  const { data: swapTransactions } = await axios.post<{
    id: string
    version: string
    success: boolean
    data: { transaction: string }[]
  }>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
    computeUnitPriceMicroLamports: String(data.data.default.h),
    swapResponse,
    txVersion,
    wallet: owner.publicKey.toBase58(),
    wrapSol: isInputSol,
    unwrapSol: isOutputSol, // true means output mint receive sol, false means output mint received wsol
    inputAccount: isInputSol ? undefined : inputTokenPublicKey?.toBase58(),
    outputAccount: isOutputSol ? undefined : outputTokenPublicKey?.toBase58(),
  });

  const allTxBuf = swapTransactions.data.map((tx) => Buffer.from(tx.transaction, 'base64'));
  const allTransactions = allTxBuf.map((txBuf) => VersionedTransaction.deserialize(txBuf));

  // console.debug(`total ${allTransactions.length} transactions`, swapTransactions)

  for (const [idx, tx] of allTransactions.entries()) {
    const transaction = tx as VersionedTransaction;
    transaction.sign([owner]);
    const txId = await connection.sendTransaction(tx as VersionedTransaction, { skipPreflight: true });
    const { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash({
      commitment: 'finalized',
    });
    console.log(`Transaction[${idx}] sending..., txId: ${txId}`);
    const confirmedTx = await connection.confirmTransaction(
      {
        blockhash,
        lastValidBlockHeight,
        signature: txId,
      },
      'confirmed',
    );

    if (!confirmedTx.value.err) {
      console.log(`Transaction[${idx}] confirmed.`);
    } else {
      console.error(`Transaction[${idx}] failed with error:`, confirmedTx.value.err);
      throw ERROR_TRANSACTION_FAILED;
    }
  }

  return true;
};
