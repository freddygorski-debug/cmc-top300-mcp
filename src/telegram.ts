export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_TEST_SECRET?: string;
  TELEGRAM_TEST_ENABLED?: string;
};

export async function sendTelegram(workerEnv: TelegramEnv, text: string): Promise<boolean> {
  const token = workerEnv.TELEGRAM_BOT_TOKEN;
  const chatId = workerEnv.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId || !/^-?\d+$/.test(chatId)) return false;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return false;
    const result = await response.json() as { ok?: boolean };
    return result.ok === true;
  } catch {
    // Never log the exception: its URL could contain the bot token.
    return false;
  }
}

