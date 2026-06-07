export function generateMerchantFingerprint(description: string, amount: number): string {
  let normalized = String(description ?? "").toLowerCase();
  normalized = normalized.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, " ");
  normalized = normalized.replace(/\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?/g, " ");
  normalized = normalized.replace(/\d{5,}/g, " ");
  normalized = normalized.replace(/\b(ref|id|txn|auth|seq)#?\s*\w+\b/g, " ");
  normalized = normalized.replace(/[^a-z0-9 ]+/g, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  const dollarBucket = Math.round(Math.abs(Number(amount) || 0));
  return `${dollarBucket}|${normalized}`;
}
