import { GetVersionedTransactionConfig } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { connection } from './config';
import { apiSwap } from './swap';

switch (process.argv[2]) {
case 'buy': {
  break;
}
case 'sell': {
  const inputMint = process.argv[3];
  const outputMint = NATIVE_MINT.toBase58();
  const amount = Number.MAX_SAFE_INTEGER;
  const message = `Swap \`${inputMint}\` to \`SOL\``;
  console.log(message);
  apiSwap(inputMint, outputMint, amount);
  break;
}
case 'get': {
  const options: GetVersionedTransactionConfig = {
    maxSupportedTransactionVersion: 0,
  };
  connection.getTransaction(process.argv[3], options).then((txInfo) => {
    if (txInfo?.meta?.err && txInfo?.meta?.logMessages) {
      console.error('Transaction warning:', txInfo.meta.err);
      console.error(txInfo.meta.logMessages.slice(-3));
    }
  });
  break;
}
default:
  console.error('Invalid command');
  break;
}
