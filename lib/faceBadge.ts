// Face boxes drawn over a photo before saving (Home's Analysis Result and the batch
// review). In a group photo the faces are small and close together: a full-size
// number badge on each box's corner covered the faces next to it, so a correct
// result looked wrong. Small boxes get a thin border and a small badge above them.
export const SMALL_FACE_SHARE = 0.07; // box width / photo width

export function faceBoxStyle(widthShare: number): { border: string; badge: string } {
  return widthShare < SMALL_FACE_SHARE
    ? { border: "border", badge: "-top-4 left-1/2 -translate-x-1/2 h-3.5 min-w-3.5 px-0.5 text-[8px]" }
    : { border: "border-2", badge: "-top-2.5 -left-2.5 h-5 w-5 text-[10px]" };
}
