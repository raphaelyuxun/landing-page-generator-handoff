/**
 * L1 knob resolution (PRD §4). Builds a complete KnobState by layering:
 *   category defaults (from CategoryProfile) → chosen combo preset → user overrides.
 */
import type { CategoryProfile, KnobState, RecommendedCombo } from '../types.js';

export function defaultKnobsFromProfile(profile: CategoryProfile): KnobState {
  const vc = profile.visualConventions;
  return {
    categoryLabel: profile.categoryLabel,
    targetMarket: 'global',
    positioning: 'technical',
    buyerType: profile.buyerPersona?.types?.[0] ?? 'importer',
    trustDriver: profile.trustDriversRanked?.[0] ?? 'compliance',
    priceStance: 'inquiry',
    brandColor: undefined,
    directionNote: undefined,

    productPhotoStyle: vc.recommendedProductPhotoStyle,
    lighting: 'soft-studio',
    composition: 'angle45',
    bannerScene: vc.recommendedBannerScene,
    i2iStrength: vc.productsLikelyHomogeneous ? 'medium' : 'high-fidelity',
    colorMood: vc.recommendedColorMood,
    backgroundComplexity: 'minimal',
    propStyle: 'none',

    copyEmphasis: ['quality'],
    toneStrength: 'restrained',
    template: 'm1',
    richnessLevel: 'standard',
    ctaUrgency: 'medium',
    socialProofStyle: profile.trustDriversRanked?.[0] === 'compliance' ? 'credential' : 'data',
  };
}

export function resolveKnobState(
  profile: CategoryProfile,
  combo?: RecommendedCombo | null,
  overrides?: Partial<KnobState>,
): KnobState {
  const base = defaultKnobsFromProfile(profile);
  const withCombo: KnobState = { ...base, ...(combo?.knobPreset ?? {}) };
  const final: KnobState = { ...withCombo, ...(overrides ?? {}) };
  // categoryLabel always defaults to the profile unless explicitly overridden
  if (!final.categoryLabel) final.categoryLabel = profile.categoryLabel;
  if (!Array.isArray(final.copyEmphasis) || final.copyEmphasis.length === 0) {
    final.copyEmphasis = ['quality'];
  }
  // TODO(临时): 版式暂时全部固定为 M1，停用 M2（后续再放开）。覆盖 combo/用户的任何 template 选择。
  final.template = 'm1';
  return final;
}
