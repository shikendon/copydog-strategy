import { NATIVE_MINT } from '@solana/spl-token';
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
default:
  console.error('Invalid command');
  break;
}
