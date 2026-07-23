export interface ChainLoadMember {
  id: string;
  hanging: boolean;
}

export function calculateAnchorLoads(members: ChainLoadMember[]): Map<string, number> {
  const loads = new Map<string, number>();
  for (const member of members) {
    if (!member.hanging) loads.set(member.id, 0);
  }
  for (let index = 0; index < members.length; index++) {
    if (!members[index]!.hanging) continue;
    let left = index - 1;
    while (left >= 0 && members[left]!.hanging) left--;
    let right = index + 1;
    while (right < members.length && members[right]!.hanging) right++;
    const leftAnchor = left >= 0 ? members[left] : undefined;
    const rightAnchor = right < members.length ? members[right] : undefined;
    if (!leftAnchor && !rightAnchor) continue;
    if (!rightAnchor || (leftAnchor && index - left < right - index)) {
      loads.set(leftAnchor!.id, (loads.get(leftAnchor!.id) ?? 0) + 1);
    } else if (!leftAnchor || right - index < index - left) {
      loads.set(rightAnchor.id, (loads.get(rightAnchor.id) ?? 0) + 1);
    } else {
      loads.set(leftAnchor.id, (loads.get(leftAnchor.id) ?? 0) + 0.5);
      loads.set(rightAnchor.id, (loads.get(rightAnchor.id) ?? 0) + 0.5);
    }
  }
  return loads;
}

export function anchorMobilityMultiplier(supportedHangingPlayers: number): number {
  const overload = Math.max(0, supportedHangingPlayers - 1);
  return 1 / (1 + overload * 0.85);
}
