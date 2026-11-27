import type { PenDocument, PenNode } from '../types';
import { resolveRefs } from '../refs';
import { substituteVariables } from '../variables';
import { layoutDocument } from './index';

function collectReusableRefs(nodes: PenNode[], out: PenNode[] = []): PenNode[] {
  for (const n of nodes) {
    if ((n as { reusable?: boolean }).reusable) {
      out.push(n);
    }
    const children = (n as { children?: PenNode[] }).children;
    if (Array.isArray(children) && children.length > 0) {
      collectReusableRefs(children, out);
    }
  }
  return out;
}

function sameArrayRef(a: PenNode[], b: PenNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Per-top-level-frame WeakMap cache for resolveRefs -> substituteVariables -> layoutDocument.
 * When editing a single screen in a multi-screen document, untouched screens reuse their
 * previously computed layout in O(1) instead of re-laying out the entire document.
 */
export class IncrementalLayoutCache {
  private cache = new WeakMap<PenNode, PenNode>();
  private lastVariables: unknown = undefined;
  private lastThemes: unknown = undefined;
  private lastTextVersion = -1;
  private lastReusables: PenNode[] = [];
  private lastComputeCount = 0;

  /** Number of top-level nodes recomputed during the most recent `compute()` call (for diagnostics/tests). */
  get lastRecomputedNodes(): number {
    return this.lastComputeCount;
  }

  /** Pre-seed cache with an already laid-out document (e.g. from useDocument on initial mount). */
  seed(rawDoc: PenDocument, laidOutDoc: PenDocument, textVersion: number): void {
    this.cache = new WeakMap<PenNode, PenNode>();
    this.lastVariables = rawDoc.variables;
    this.lastThemes = rawDoc.themes;
    this.lastTextVersion = textVersion;
    this.lastReusables = collectReusableRefs(rawDoc.children);
    this.lastComputeCount = 0;

    if (rawDoc.children.length === laidOutDoc.children.length) {
      for (let i = 0; i < rawDoc.children.length; i++) {
        this.cache.set(rawDoc.children[i], laidOutDoc.children[i]);
      }
    }
  }

  compute(rawDoc: PenDocument, textVersion: number): PenDocument {
    const reusables = collectReusableRefs(rawDoc.children);
    const contextChanged =
      rawDoc.variables !== this.lastVariables ||
      rawDoc.themes !== this.lastThemes ||
      textVersion !== this.lastTextVersion ||
      !sameArrayRef(reusables, this.lastReusables);

    if (contextChanged) {
      this.cache = new WeakMap<PenNode, PenNode>();
      this.lastVariables = rawDoc.variables;
      this.lastThemes = rawDoc.themes;
      this.lastTextVersion = textVersion;
      this.lastReusables = reusables;
    }

    let recomputed = 0;
    const nextChildren: PenNode[] = rawDoc.children.map((rawChild) => {
      const hit = this.cache.get(rawChild);
      if (hit) return hit;

      recomputed++;
      const singleDoc: PenDocument = { ...rawDoc, children: [rawChild] };
      const resolved = resolveRefs(singleDoc, { components: reusables });
      const substituted = substituteVariables(resolved);
      const laidOut = layoutDocument(substituted);
      const resultNode = laidOut.children[0] ?? rawChild;
      this.cache.set(rawChild, resultNode);
      return resultNode;
    });

    this.lastComputeCount = recomputed;
    return { ...rawDoc, children: nextChildren };
  }
}
