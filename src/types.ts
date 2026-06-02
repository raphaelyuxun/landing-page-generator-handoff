/**
 * EaseSourcer data contracts — single source of truth (PRD §3, §4, §5).
 * All cross-module objects must conform to these types.
 */

// ============================================================================
// §3.1 FormInput — system total input
// ============================================================================

export interface FormProductInput {
  nameCn: string;
  nameEn: string;
  sellingPointCn?: string;
  /** customer-uploaded raw image references (local paths / asset ids), >=1 */
  rawImages: string[];
  /** model number (🔴 hard claim); only if explicitly present in customer input */
  modelNo?: string;
}

export interface FormInput {
  /** business code, e.g. "folic-acid-cn"; auto-derived from the EN name if empty */
  code: string;
  /** 客户公司名 (merchant_name) — 列表显示名 = merchantName-slug；前端创建时收集，存入 echo.merchant_name */
  merchantName?: string;
  /** 每张输入图的描述（外部接口 images[].description），键为 rawImages 的 ref（如 "raw/dl-0.jpg"）。可选、向后兼容。 */
  imageDescriptions?: Record<string, string>;
  /** explicit product category provided by the operator (产品类别) — strong profiler signal */
  categoryHint?: string;
  companyIntroCn: string;
  productFeaturesCn: string;
  useScenariosCn: string;
  /** one or more products (simplified intake: a single product per task) */
  products: FormProductInput[];
  /** contact (🔴 hard claim); only from customer, else site default */
  contact?: {
    email?: string;
    /** WhatsApp, with + country code, no spaces/hyphens */
    wa?: string;
  };
}

// ============================================================================
// §3.2 content.json contract
// ============================================================================

export interface ContentData {
  // ----- required (missing any => error) -----
  code: string;
  schemaVersion: 1;
  /** "YYYY-MM-DD HH:mm:ss" */
  updateTime?: string;
  /** Hero title, <=30 chars suggested */
  title: string;
  /** Hero subtitle, <=50 chars suggested */
  subtitle: string;
  /** Hero background image URL (local version: {{ASSET:...}} placeholder) */
  banner: string;

  // ----- optional (display tri-state) -----
  contact?: { email?: string; wa?: string };
  cta?: { bottomTitle?: string; bottomSubtitle?: string };
  stats?: {
    sectionTitle?: string;
    items: { value: string; label: string }[];
  };
  certifications?: {
    sectionTitle?: string;
    items: string[];
  };
  trust?: {
    sectionTitle?: string;
    items: { icon: string; title: string; desc: string }[];
  };
  testimonials?: {
    sectionTitle?: string;
    items: { quote: string; author: string }[];
  };
  faq?: {
    sectionTitle?: string;
    items: { q: string; a: string }[];
  };
}

// ============================================================================
// §3.3 products.json contract
// ============================================================================

export interface ProductSpec {
  label: string; // 🟡 transliterated/translated spec name
  value: string; // 🔴 spec value (numeric tech params; AI must NOT generate)
}

export interface ProductData {
  id: string;
  code: string;
  productName: string; // H1
  description?: string; // selling subtitle under H1
  images?: string[]; // first is main (local: {{ASSET:...}} placeholder)
  price?: number; // usually 0 => frontend hides
  quantity?: number; // usually 0
  updateTime: string;
  sourceUrl?: string;
  googleParam?: string;
  subtitle?: string; // 🔴 model no, e.g. "DC-FA-97"
  specs?: ProductSpec[]; // 🔴 NOT generated this version (§8.4)
}

// ============================================================================
// §4.2 KnobState
// ============================================================================

export type TargetMarket = 'na' | 'weu' | 'mideast' | 'sea' | 'latam' | 'global';
export type Positioning = 'technical' | 'premium' | 'value';
export type BuyerType = 'importer' | 'brand' | 'factory' | 'trader';
export type TrustDriver = 'factory' | 'compliance' | 'customization' | 'price';
export type PriceStance = 'show-price' | 'inquiry' | 'sample-first';
export type ProductPhotoStyle = 'studio-solid' | 'gradient' | 'minimal-scene' | 'industrial';
export type Lighting = 'soft-studio' | 'hard-texture' | 'natural';
export type Composition = 'front' | 'angle45' | 'center-closeup';
export type BannerScene = 'lab' | 'production-line' | 'warehouse' | 'application' | 'abstract-brand';
export type I2iStrength = 'high-fidelity' | 'medium' | 'low';
export type ColorMood = 'cool-pro' | 'warm-vivid' | 'dark-premium' | 'clean-bright';
export type BackgroundComplexity = 'minimal' | 'light-texture' | 'scene';
export type PropStyle = 'none' | 'industry-props' | 'packaging';
export type CopyEmphasis = 'quality' | 'price-moq' | 'oem' | 'logistics' | 'capacity';
export type ToneStrength = 'restrained' | 'neutral' | 'promotional';
export type Template = 'm1' | 'm2';
export type RichnessLevel = 'lean' | 'standard' | 'rich';
export type CtaUrgency = 'calm' | 'medium' | 'strong';
export type SocialProofStyle = 'data' | 'word-of-mouth' | 'credential';

export interface KnobState {
  // ---- shared (copy + image) ----
  categoryLabel: string;
  targetMarket: TargetMarket;
  positioning: Positioning;
  buyerType: BuyerType;
  trustDriver: TrustDriver;
  priceStance: PriceStance;
  brandColor?: string;
  directionNote?: string;

  // ---- image group ----
  productPhotoStyle: ProductPhotoStyle;
  lighting: Lighting;
  composition: Composition;
  bannerScene: BannerScene;
  i2iStrength: I2iStrength;
  colorMood: ColorMood;
  backgroundComplexity: BackgroundComplexity;
  propStyle: PropStyle;

  // ---- copy group ----
  copyEmphasis: CopyEmphasis[];
  toneStrength: ToneStrength;
  template: Template;
  richnessLevel: RichnessLevel;
  ctaUrgency: CtaUrgency;
  socialProofStyle: SocialProofStyle;
}

// ============================================================================
// §5.2 CategoryProfile
// ============================================================================

export interface CategoryProfile {
  categoryLabel: string;
  matchedAnchors: string[];
  buyerPersona: {
    types: BuyerType[];
    primaryConcerns: string[];
  };
  trustDriversRanked: TrustDriver[];
  plausibleStats: {
    yearsExperience: [number, number];
    annualCapacity: { range: [number, number]; unit: string };
    countriesExported: [number, number];
    extra?: { label: string; range: [number, number]; unit: string }[];
  };
  typicalCertifications: string[];
  visualConventions: {
    recommendedProductPhotoStyle: ProductPhotoStyle;
    recommendedBannerScene: BannerScene;
    recommendedColorMood: ColorMood;
    subjectPresentation: string;
    productsLikelyHomogeneous: boolean;
  };
  faqDirections: string[];
  sellingPointPriority: string[];
}

// ============================================================================
// §5.3 RecommendedCombo
// ============================================================================

export type ComboArchetype = 'compliance-anchored' | 'capacity-strength' | 'fast-conversion';

export interface RecommendedCombo {
  archetype: ComboArchetype;
  displayName: string;
  fitFor: string;
  rationale: string;
  knobPreset: Partial<KnobState>;
}

// ============================================================================
// §3.4 GenerationProject — aggregate root through the lifecycle
// ============================================================================

export type ProjectState =
  | 'DRAFT_INPUT'
  | 'PROFILED'
  | 'KNOBS_SET'
  | 'GENERATING'
  | 'VALIDATED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'EXPORTED';

export interface CompiledPrompt {
  /** human-readable label, e.g. "Banner" / "参考图 (g1)" / "产品图: Folic Acid" */
  label?: string;
  text: string;
  trace: { knobKey: string; chosenValue: string; templateBlockId: string }[];
  overridden: boolean;
}

export interface AssetQAResult {
  hasUnexpectedText: boolean;
  subjectFidelityScore?: number;
  dimensionOk: boolean;
  needsAttention: boolean;
}

export interface GeneratedAsset {
  kind: 'banner' | 'product' | 'style-reference';
  groupId?: string;
  productIndex?: number;
  localPath: string;
  exportName: string;
  prompt: string;
  qa?: AssetQAResult;
}

export interface ValidationReport {
  hardClaimViolations: {
    path: string;
    value: string;
    reason: 'no-provenance' | 'mismatch';
    action: 'cleared' | 'module-hidden';
  }[];
  tierWarnings: { path: string; note: string }[];
  passed: boolean;
}

export interface ReviewEdit {
  at: string;
  kind: 'edit-field' | 'remove-module' | 'remove-product' | 'regen-image';
  path: string;
  note?: string;
}

export interface JobStatus {
  /** 'profile' | 'copy' | 'images' | 'generate' | 'revise' */
  kind: string;
  status: 'running' | 'done' | 'error';
  step: string;
  current?: number;
  total?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface GenerationProject {
  code: string;
  state: ProjectState;
  createdAt: string;
  updatedAt: string;
  /** stable external-integration id (lp_xxx); independent of `code` (which is the editable URL slug) */
  landingpageId?: string;
  /** external campaign (投放任务) id this landing page belongs to */
  campaignId?: string;
  /** true if created via the "create variant" path */
  isVariant?: boolean;
  /** sequence within a campaign (main = 0) */
  variantNo?: number;
  /** operator marked it done & deliverable */
  markedReady?: boolean;
  /** external side has pulled the delivery at least once */
  delivered?: boolean;
  /** external request fields passed through verbatim (stored only) */
  echo?: Record<string, unknown>;
  /** transient status of a running/finished background job (for UI polling) */
  job?: JobStatus;
  /** generation logs (info/warn/error) surfaced in the UI for debugging */
  logs?: LogEntry[];
  formInput: FormInput;
  categoryProfile?: CategoryProfile;
  recommendedCombos?: RecommendedCombo[];
  knobState?: KnobState;
  contentDraft?: ContentData;
  productsDraft?: ProductData[];
  assets?: GeneratedAsset[];
  /** 仅在图片(重新)生成时更新；用于图片 URL 的缓存刷新参数，避免纯文案编辑触发图片重载 */
  assetsVersion?: string;
  /** 外部创建接口收到的完整原始 payload（排查用，原样存档） */
  apiPayload?: unknown;
  /** 已归档（只读）。归档是唯一的"移除"方式，无硬删除。 */
  archived?: boolean;
  l2Prompts?: {
    copy?: CompiledPrompt;
    images?: CompiledPrompt[];
  };
  validationReport?: ValidationReport;
  reviewEdits?: ReviewEdit[];
}

// ============================================================================
// Config file shapes (§4.5 knobs.config.json, §5.4 anchors.config.json)
// ============================================================================

export interface KnobOption {
  value: string;
  label: string;
  /** template block injected into the image L2 (image-group knobs) */
  l2Block?: string;
  /** directive injected into the copy L2 system prompt (copy-group knobs) */
  copyDirective?: string;
}

export interface KnobDef {
  label: string;
  group: 'shared' | 'image' | 'copy';
  multi?: boolean;
  freeText?: boolean;
  options: KnobOption[];
}

export interface KnobsConfig {
  version: number;
  knobs: Record<string, KnobDef>;
}

export interface AnchorEntry {
  id: string;
  displayName: string;
  profile: CategoryProfile;
  recommendedCombos?: RecommendedCombo[];
  hints?: string;
}

export interface AnchorsConfig {
  version: number;
  anchors: AnchorEntry[];
}
