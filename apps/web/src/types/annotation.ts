/**
 * Mudbrick v2 -- Annotation TypeScript types
 *
 * These mirror the Fabric.js JSON serialization format used as the
 * canonical annotation exchange format between frontend and backend.
 */

import type { ShapeId } from '@mudbrick/shared/src/constants';

export interface AnnotationBase {
  id: string;
  type: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle: number;
  opacity: number;
  visible: boolean;
  selectable: boolean;
}

export interface FreehandAnnotation extends AnnotationBase {
  type: 'path';
  path: Array<[string, ...number[]]>;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'rect';
  tool: 'highlight';
  fill: string;
  opacity: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: 'textbox';
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'rect' | 'ellipse' | 'line';
  shapeType: ShapeId;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export interface StampAnnotation extends AnnotationBase {
  type: 'image';
  tool: 'stamp';
  src: string;
}

export interface RedactAnnotation extends AnnotationBase {
  type: 'rect';
  tool: 'redact';
  fill: string;
}

export type Annotation =
  | FreehandAnnotation
  | HighlightAnnotation
  | TextAnnotation
  | ShapeAnnotation
  | StampAnnotation
  | RedactAnnotation;

/** Per-page annotation collection (Fabric.js JSON format) */
export interface PageAnnotations {
  version: string;
  objects: Annotation[];
}

/** Annotation tool properties */
export interface ToolProperties {
  color: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  fontFamily: string;
  shapeType: ShapeId;
}
