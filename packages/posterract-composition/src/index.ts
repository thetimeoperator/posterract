/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The authoring surface: the types project sources are written against, the
 * pure helpers they may call, and the hooks the editor implements. The
 * renderer that turns this vocabulary into a composition is not here — the
 * editor supplies it when a project is mounted (see
 * @posterract/video-reconciler), so nothing in this package touches a host.
 */

export {
  generate,
  AssetRef,
  isAssetRef,
  getAssetSpec,
  serializeAssetRef,
  isSerializedAssetRef,
} from "./generate.js";
export type {
  AspectRatio,
  AssetInput,
  AssetSpecInput,
  FlatAssetSpec,
  SerializedAssetRef,
  GenerateAudioOptions,
  GenerateImageOptions,
  GenerateVideoOptions,
  GenerateVoiceOptions,
} from "./generate.js";
export { parseTime, TIME_FPS } from "./time.js";
export {
  COMPOSITION_TAGS,
  ID_ATTR,
  LOOP_ATTR,
  LOOP_TAGS,
  SOURCE_ATTR,
  formatSource,
  isCompositionTag,
  isLoopTag,
  isPropValue,
  parseSource,
} from "./source.js";
export type { CompositionTag, PropValue } from "./source.js";
export { useTicker } from "./hooks.js";
export type { Ticker } from "./hooks.js";
export { INSPECT_TAG, INSPECT_TYPES, __inspect } from "./inspect.js";
export type { InspectDeclaration, InspectType, InspectValue } from "./inspect.js";
export type {
  AdjustmentLayerProps,
  AnimatableProperty,
  AnimationProps,
  AnimationType,
  AudioProps,
  BlendMode,
  CameraMatrix,
  CaptionPreset,
  CaptionsProps,
  ColorStopProps,
  DiagramArrowProps,
  DiagramAxisProps,
  DiagramCalloutProps,
  DiagramEquationProps,
  DiagramNodeProps,
  DiagramNodeShape,
  DiagramPlotProps,
  DiagramPoint,
  DiagramRoute,
  Easing,
  EffectProps,
  EffectType,
  Fit,
  GradientPaintProps,
  GroupProps,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  KeyframeProps,
  KeyframeTrackProps,
  MediaPaintProps,
  RectProps,
  SceneNode,
  SceneProps,
  SequenceProps,
  ShaderPaintProps,
  ShadowProps,
  SolidPaintProps,
  SourceProps,
  StageProps,
  StrokeCap,
  StrokeJoin,
  StrokeProps,
  SurfacePaintProps,
  SurfaceProps,
  TextCase,
  TextProps,
  TextRangeProps,
  Time,
  TransitionSpec,
  TransitionType,
  VideoProps,
} from "./types.js";
