import dotenv from 'dotenv';

dotenv.config();

export const sendSlackMessage = async function (message: string): Promise<void> {
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;
  if (!SLACK_WEBHOOK) {
    throw new Error('SLACK_WEBHOOK is not set');
  }

  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send slack message: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('Sending Slack message error:', error.message);
    } else {
      console.error(error);
    }
  }
};
