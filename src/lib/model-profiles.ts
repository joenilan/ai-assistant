import type { BackendStatus, ControlModelProfile, ControlState, RuntimeConfig } from "@/lib/assistant";

const profileTierRank: Record<string, number> = {
  default: 0,
  backup: 1,
  alternate: 2,
  quality_slow: 3,
  legacy: 4,
};

export function getActiveProfile(controlState: ControlState | null) {
  if (!controlState) {
    return null;
  }

  return (
    controlState.models.find((model) => model.active) ||
    controlState.models.find((model) => model.alias === controlState.currentAlias) ||
    null
  );
}

export function getBackendModel(
  controlState: ControlState | null,
  backendStatus: BackendStatus | null,
  runtimeConfig: RuntimeConfig | null,
) {
  return (
    controlState?.liveModel ||
    controlState?.currentModel ||
    backendStatus?.activeModel ||
    runtimeConfig?.llmModel ||
    ""
  );
}

export function sortModelProfiles(models: ControlModelProfile[]) {
  return [...models].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }

    const leftRank = profileTierRank[left.uiTier] ?? 99;
    const rightRank = profileTierRank[right.uiTier] ?? 99;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.recommended !== right.recommended) {
      return left.recommended ? -1 : 1;
    }

    return left.alias.localeCompare(right.alias);
  });
}

export function getProfileTierLabel(profile: ControlModelProfile) {
  switch (profile.uiTier) {
    case "default":
      return "Default";
    case "backup":
      return "Backup";
    case "quality_slow":
      return "Slow quality";
    case "legacy":
      return "Legacy";
    default:
      return profile.role;
  }
}
