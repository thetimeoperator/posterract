import { useWorld } from "@posterract/koota-solid";
import { getRuntimeDocument } from "@posterract/video-reconciler";

export function useDocument() {
  const world = useWorld();
  return () => getRuntimeDocument(world);
}
