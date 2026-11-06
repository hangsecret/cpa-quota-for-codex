export function groupAccounts(accounts, modelId) {
  const matching = [];
  const others = [];
  for (const account of accounts) {
    // Only backend-confirmed model IDs can identify a supplier for a model.
    const matches = !!modelId && account.modelDiscovery === 'confirmed' && account.models?.includes(modelId);
    (matches ? matching : others).push(account);
  }
  return { matching, others };
}
