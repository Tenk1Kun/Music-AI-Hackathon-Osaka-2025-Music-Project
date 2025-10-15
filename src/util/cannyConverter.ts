import type { RefObject } from "react";

export type EdgePoint = { x: number; y: number; mag: number; theta: number };

/**
 * Runs RGBA→gray → blur → Canny and returns edge pixels as {x,y,mag,theta}.
 * If imageOut is provided, draws the Canny result to that canvas.
 */
export const canny = (
  cv: any,
  imageIn: RefObject<HTMLCanvasElement | HTMLImageElement>,
  imageOut?: RefObject<HTMLCanvasElement>
): EdgePoint[] => {
  // Allocations
  const src = cv.imread(imageIn.current);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const gradX = new cv.Mat();
  const gradY = new cv.Mat();

  try {
    // RGBA -> Gray
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Small blur to stabilize Canny
    const ksize = new cv.Size(5, 1);
    cv.GaussianBlur(gray, blurred, ksize, 0);

    // Canny edges
    cv.Canny(blurred, edges, 350, 450, 3);

    // Gradients for magnitude/orientation (float32)
    cv.Sobel(gray, gradX, cv.CV_32F, 1, 0, 3);
    cv.Sobel(gray, gradY, cv.CV_32F, 0, 1, 3);

    // (Optional) preview
    if (imageOut?.current) cv.imshow(imageOut.current, edges);

    // Collect edge points with mag/theta
    const points: EdgePoint[] = [];
    for (let y = 0; y < edges.rows; y++) {
      for (let x = 0; x < edges.cols; x++) {
        if (edges.ucharPtr(y, x)[0] !== 0) {
          const gx = gradX.floatAt(y, x);
          const gy = gradY.floatAt(y, x);
          const mag = Math.hypot(gx, gy);
          const theta = Math.atan2(gy, gx);
          points.push({ x, y, mag, theta });
        }
      }
    }
    return points;
  } finally {
    // Clean up in all cases
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    gradX.delete();
    gradY.delete();
  }
};