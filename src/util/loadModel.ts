import * as tf from "@tensorflow/tfjs";

let model: tf.LayersModel | null = null;

export const loadKotoModel = async () => {
  if (!model) {
    model = await tf.loadLayersModel("/model/model.json");
  }
  return model;
};
