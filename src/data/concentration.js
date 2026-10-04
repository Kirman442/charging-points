export const CONCENTRATION_THRESHOLD = 60

// A descriptive infrastructure indicator; this is not a legal market definition.
export function operatorConcentration(operators, basis = 'points') {
  const distribution = operators?.[basis]
  const leader = distribution?.leaders?.[0]
  if (!distribution || distribution.total <= 0 || leader?.share == null) return null
  return { name: leader.name, share: leader.share, value: leader.value, total: distribution.total, operatorCount: operators.count, high: leader.share > CONCENTRATION_THRESHOLD }
}
