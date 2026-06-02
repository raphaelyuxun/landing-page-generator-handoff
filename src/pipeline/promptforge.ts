/**
 * PromptForge (PRD §6/§7 shared infra) — looks up knob injection blocks from
 * knobs.config.json and assembles L2 prompts with a traceable provenance.
 */
import { loadKnobs } from '../config.js';
import type { CompiledPrompt, KnobState } from '../types.js';

type TraceEntry = CompiledPrompt['trace'][number];

/** Get the l2Block (image) for a single-value knob. */
export function imageBlock(knobKey: string, value: string): { block: string; trace: TraceEntry } | null {
  const def = loadKnobs().knobs[knobKey];
  const opt = def?.options.find((o) => o.value === value);
  if (!opt?.l2Block) return null;
  return { block: opt.l2Block, trace: { knobKey, chosenValue: value, templateBlockId: `${knobKey}.${value}` } };
}

/** Get the copyDirective for a single-value knob. */
export function copyDirective(knobKey: string, value: string): { block: string; trace: TraceEntry } | null {
  const def = loadKnobs().knobs[knobKey];
  const opt = def?.options.find((o) => o.value === value);
  if (!opt?.copyDirective) return null;
  return { block: opt.copyDirective, trace: { knobKey, chosenValue: value, templateBlockId: `${knobKey}.${value}` } };
}

/** Collect copy directives for the copy-relevant knobs of a KnobState. */
export function collectCopyDirectives(knobs: KnobState): { lines: string[]; trace: TraceEntry[] } {
  const lines: string[] = [];
  const trace: TraceEntry[] = [];
  const single: (keyof KnobState)[] = [
    'targetMarket',
    'positioning',
    'buyerType',
    'trustDriver',
    'priceStance',
    'toneStrength',
    'richnessLevel',
    'ctaUrgency',
    'socialProofStyle',
  ];
  for (const key of single) {
    const got = copyDirective(key, String(knobs[key]));
    if (got) {
      lines.push(got.block);
      trace.push(got.trace);
    }
  }
  // multi-select copyEmphasis
  for (const v of knobs.copyEmphasis || []) {
    const got = copyDirective('copyEmphasis', v);
    if (got) {
      lines.push(got.block);
      trace.push(got.trace);
    }
  }
  if (knobs.directionNote && knobs.directionNote.trim()) {
    lines.push(`Extra direction: ${knobs.directionNote.trim()}`);
    trace.push({ knobKey: 'directionNote', chosenValue: 'custom', templateBlockId: 'directionNote' });
  }
  return { lines, trace };
}

/** Collect image L2 blocks in the §7.2 template order. */
export function collectImageBlocks(knobs: KnobState): { blocks: { tag: string; text: string }[]; trace: TraceEntry[] } {
  const blocks: { tag: string; text: string }[] = [];
  const trace: TraceEntry[] = [];
  const push = (tag: string, knobKey: string, value: string) => {
    const got = imageBlock(knobKey, value);
    if (got) {
      blocks.push({ tag, text: got.block });
      trace.push(got.trace);
    }
  };
  push('COMPOSITION', 'composition', knobs.composition);
  push('LIGHTING', 'lighting', knobs.lighting);
  push('BACKGROUND', 'productPhotoStyle', knobs.productPhotoStyle);
  push('BACKGROUND', 'backgroundComplexity', knobs.backgroundComplexity);
  push('PROPS', 'propStyle', knobs.propStyle);
  push('COLOR', 'colorMood', knobs.colorMood);
  return { blocks, trace };
}
