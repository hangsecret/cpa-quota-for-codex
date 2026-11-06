export function compactWindows(account, modelId) {
  const windows = account.windows || [];
  const short = windows.find(row => /主配额.*短周期|每日额度|five.*hour|5.*hour/i.test(row.label));
  const long = windows.find(row => /主配额.*长周期|每周额度|^seven days?$|^7 days?$/i.test(row.label));
  if (account.provider === 'codex' || short || long) return [
    { label: '短周期', remainingPercent: short?.remainingPercent ?? null, resetAt: short?.resetAt || null },
    { label: '长周期', remainingPercent: long?.remainingPercent ?? null, resetAt: long?.resetAt || null }
  ];
  const modelWindow = windows.find(row => row.label === modelId || row.label === modelId?.split('/').at(-1));
  if (['gemini', 'antigravity'].includes(account.provider) && !modelWindow) return [];
  return (modelWindow ? [modelWindow] : windows).slice(0, 2);
}
