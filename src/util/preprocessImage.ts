import * as tf from "@tensorflow/tfjs";

export const preprocessImage = async (file: File): Promise<tf.Tensor4D> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;

      img.onload = () => {
        const tensor = tf.tidy(() => {
          const imageTensor = tf.browser.fromPixels(img).toFloat();
          const resized = tf.image.resizeBilinear(imageTensor, [128, 128]);
          const normalized = resized.div(255.0);
          return normalized.expandDims(0) as tf.Tensor4D;
        });
        resolve(tensor);
      };

      img.onerror = reject;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
