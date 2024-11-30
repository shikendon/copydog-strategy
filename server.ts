import dotenv from 'dotenv';
import fs from 'fs';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  ERROR_INPUT_TOKEN_ACCOUNT_NOT_FOUND,
  ERROR_COMPUTE_SWAP_FAILED,
  ERROR_OUTPUT_AMOUNT_TOO_LOW,
} from './swap';
import { apiSwap } from './swap';
import { sendSlackMessage } from './slack';

dotenv.config();

const API_URL = process.env.API_URL || '';
const API_TOKEN = process.env.API_TOKEN;
const trendTokens: { [key: string]: TokenItem } = {};
const trendTokensFile = '.cache/trendTokens.json';

interface TokenItem {
  id: number;
  tokenName: string;
  liquidity: number;
  tokenAddress: string;
  initialPrice: number;
  m1Price: number;
  createTime: string;
  closedTime: number;
  boughtIn?: boolean;
  soldOut?: boolean;
}

if (fs.existsSync(trendTokensFile)) {
  const fileContent = fs.readFileSync(trendTokensFile, 'utf8');
  Object.assign(trendTokens, JSON.parse(fileContent));
}

async function fetchChangeAlert() {
  let tokenItems: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    tokenItems = data.data.list.reverse();
  } catch (error) {
    if (error instanceof Error) {
      console.error('Fetching 金狗预警 error:', error.message);
    } else {
      console.error(error);
    }
  }

  for (const tokenItem of tokenItems) {
    const { id, tokenName, liquidity, tokenAddress, initialPrice, m1Price, createTime } = tokenItem;

    const dateTime = new Date(createTime);
    const priceChange = (m1Price - initialPrice) / initialPrice;
    const priceChangeStr = (priceChange * 100).toFixed(2);
    const closedTime = new Date(createTime).getTime() + 30 * 60 * 1000;

    if (tokenAddress in trendTokens) {
      continue;
    } else {
      console.log(id, `\`${tokenName}\``, liquidity, tokenAddress, `${priceChangeStr}%`, dateTime);
      trendTokens[tokenAddress] = {
        id,
        tokenName,
        liquidity,
        tokenAddress,
        initialPrice,
        m1Price,
        createTime,
        closedTime,
        boughtIn: undefined,
        soldOut: undefined,
      };
      break;
    }
  }

  for (const tokenItem of Object.values(trendTokens)) {
    if (tokenItem.boughtIn === undefined && tokenItem.closedTime > Date.now()) {
      if (tokenItem.closedTime - Date.now() < 25 * 60 * 1000) {
        const consoleMessage = `Time too late to buy in \`${tokenItem.tokenName}\``;
        console.error(consoleMessage);
        sendSlackMessage(consoleMessage);
        tokenItem.boughtIn = false;
        continue;
      }

      const success = await buyInToken(tokenItem.tokenName, tokenItem.tokenAddress);
      if (success) {
        const consoleMessage = `Bought in \`${tokenItem.tokenName}\``;
        console.log(consoleMessage);
        sendSlackMessage(consoleMessage);
      } else {
        const consoleMessage = `Failed to buy in \`${tokenItem.tokenName}\``;
        console.error(consoleMessage);
        sendSlackMessage(consoleMessage);
        continue;
      }

      tokenItem.boughtIn = true;
    }

    if (tokenItem.boughtIn && tokenItem.soldOut == undefined) {
      tokenItem.soldOut = false;
      setTimeout(async function () {
        const success = await sellOutToken(tokenItem.tokenName, tokenItem.tokenAddress);
        if (success) {
          const consoleMessage = `Sold out \`${tokenItem.tokenName}\``;
          console.log(consoleMessage);
          sendSlackMessage(consoleMessage);
        } else {
          const consoleMessage = `Failed to sell out \`${tokenItem.tokenName}\``;
          console.error(consoleMessage);
          sendSlackMessage(consoleMessage);
        }
        tokenItem.soldOut = true;
      }, tokenItem.closedTime - Date.now());
      const localCloseTime = new Date(tokenItem.closedTime).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      console.log(`Scheduled sell out \`${tokenItem.tokenName}\` at`, localCloseTime);
    }
  }

  fs.writeFileSync(trendTokensFile, JSON.stringify(trendTokens, null, 2));
}

async function buyInToken(tokenName: string, mintAddress: string) {
  const inputMint = NATIVE_MINT.toBase58();
  const outputMint = mintAddress;
  const amount = 0.05 * 1_000_000_000; // lamports
  const message = `Swap \`SOL\` to \`${tokenName}\`[${mintAddress}]`;
  console.log(message);
  sendSlackMessage(message);

  try {
    return await apiSwap(inputMint, outputMint, amount);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Buying in \`${tokenName}\` error: ${error.message}`);
    } else {
      console.error(error);
    }
  }
  return false;
}

async function sellOutToken(tokenName: string, mintAddress: string, retries = 10) {
  const inputMint = mintAddress;
  const outputMint = NATIVE_MINT.toBase58();
  const amount = Number.MAX_SAFE_INTEGER;
  const message = `Swap \`${tokenName}\`[${mintAddress}] to \`SOL\``;
  console.log(message);
  sendSlackMessage(message);
  while (retries >= 0) {
    try {
      return await apiSwap(inputMint, outputMint, amount);
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
        case ERROR_INPUT_TOKEN_ACCOUNT_NOT_FOUND.message:
          retries = 0;
          break;
        case ERROR_COMPUTE_SWAP_FAILED.message:
          retries = 0;
          break;
        case ERROR_OUTPUT_AMOUNT_TOO_LOW.message:
          retries = 0;
          break;
        }
        console.error(`Selling out \`${tokenName}\` error(${retries}): ${error.message}`);
      } else {
        console.error(error);
      }
      retries--;
    }
  }
  return false;
}

function run() {
  fetchChangeAlert().then(function () {
    setTimeout(run, 10 * 1000);
  });
}

run();
console.log('Running...');
