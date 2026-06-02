// Minimal mirror of backend contracts used by the UI.

export interface FormProductInput {
  nameCn: string;
  nameEn: string;
  sellingPointCn?: string;
  rawImages: string[];
  modelNo?: string;
}
export interface FormInput {
  code: string;
  merchantName?: string;
  imageDescriptions?: Record<string, string>;
  categoryHint?: string;
  companyIntroCn: string;
  productFeaturesCn: string;
  useScenariosCn: string;
  products: FormProductInput[];
  contact?: { email?: string; wa?: string };
}

export interface ContentData {
  code: string;
  schemaVersion: 1;
  updateTime?: string;
  title: string;
  subtitle: string;
  banner: string;
  contact?: { email?: string; wa?: string };
  cta?: { bottomTitle?: string; bottomSubtitle?: string };
  stats?: { sectionTitle?: string; items: { value: string; label: string }[] };
  certifications?: { sectionTitle?: string; items: string[] };
  trust?: { sectionTitle?: string; items: { icon: string; title: string; desc: string }[] };
  testimonials?: { sectionTitle?: string; items: { quote: string; author: string }[] };
  faq?: { sectionTitle?: string; items: { q: string; a: string }[] };
}
export interface ProductData {
  id: string;
  code: string;
  productName: string;
  description?: string;
  images?: string[];
  subtitle?: string;
  updateTime: string;
}

export interface RecommendedCombo {
  archetype: 'compliance-anchored' | 'capacity-strength' | 'fast-conversion';
  displayName: string;
  fitFor: string;
  rationale: string;
  knobPreset: Partial<KnobState>;
}

export interface CategoryProfile {
  categoryLabel: string;
  matchedAnchors: string[];
  buyerPersona: { types: string[]; primaryConcerns: string[] };
  trustDriversRanked: string[];
  plausibleStats: any;
  typicalCertifications: string[];
  visualConventions: any;
  faqDirections: string[];
  sellingPointPriority: string[];
}

export interface KnobState {
  categoryLabel: string;
  targetMarket: string;
  positioning: string;
  buyerType: string;
  trustDriver: string;
  priceStance: string;
  brandColor?: string;
  directionNote?: string;
  productPhotoStyle: string;
  lighting: string;
  composition: string;
  bannerScene: string;
  i2iStrength: string;
  colorMood: string;
  backgroundComplexity: string;
  propStyle: string;
  copyEmphasis: string[];
  toneStrength: string;
  template: 'm1' | 'm2';
  richnessLevel: string;
  ctaUrgency: string;
  socialProofStyle: string;
}

export interface ValidationReport {
  hardClaimViolations: { path: string; value: string; reason: string; action: string }[];
  tierWarnings: { path: string; note: string }[];
  passed: boolean;
}

export interface GeneratedAsset {
  kind: string;
  productIndex?: number;
  exportName: string;
  prompt: string;
  qa?: { hasUnexpectedText: boolean; dimensionOk: boolean; needsAttention: boolean };
}

export interface JobStatus {
  kind: 'profile' | 'copy' | 'images';
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

export interface Project {
  code: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  job?: JobStatus;
  logs?: LogEntry[];
  markedReady?: boolean;
  echo?: Record<string, unknown>;
  formInput: FormInput;
  categoryProfile?: CategoryProfile;
  recommendedCombos?: RecommendedCombo[];
  knobState?: KnobState;
  contentDraft?: ContentData;
  productsDraft?: ProductData[];
  assets?: GeneratedAsset[];
  assetsVersion?: string;
  apiPayload?: unknown;
  archived?: boolean;
  validationReport?: ValidationReport;
  l2Prompts?: { copy?: { text: string; overridden: boolean; label?: string }; images?: { text: string; label?: string }[] };
}

export interface RevisionPlan {
  understanding: string;
  todos: string[];
  copy: boolean;
  banner: boolean;
  productIndexes: number[];
}

export interface ProjectListItem {
  code: string;
  merchantName?: string;
  state: string;
  updatedAt: string;
  job?: JobStatus;
  productCount?: number;
  markedReady?: boolean;
  archived?: boolean;
}

export interface KnobOption { value: string; label: string; l2Block?: string; copyDirective?: string }
export interface KnobDef { label: string; group: string; multi?: boolean; freeText?: boolean; options: KnobOption[] }
export interface KnobsConfig { version: number; knobs: Record<string, KnobDef> }
