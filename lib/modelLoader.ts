import * as tf from '@tensorflow/tfjs';
import { SignType, SIGN_TYPES } from '@/types/classification';
import path from 'path';
import fs from 'fs';

let model: tf.LayersModel | null = null;

export async function loadModel(): Promise<tf.LayersModel> {
    if (model) {
        return model;
    }

    try {
        // Set backend to CPU for server-side inference
        await tf.setBackend('cpu');
        await tf.ready();

        // Load model from public directory using Node.js file system
        const modelDir = path.join(process.cwd(), 'public', 'model');
        const modelJsonPath = path.join(modelDir, 'model.json');
        const weightsPath = path.join(modelDir, 'weights.bin');

        console.log('Loading model from:', modelJsonPath);

        // Read model.json
        const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));

        // Read weights.bin
        const weightsData = fs.readFileSync(weightsPath);

        // Create a custom IO handler for loading from memory
        const ioHandler: tf.io.IOHandler = {
            load: async () => {
                return {
                    modelTopology: modelJson.modelTopology,
                    weightSpecs: modelJson.weightsManifest[0].weights,
                    weightData: weightsData.buffer.slice(
                        weightsData.byteOffset,
                        weightsData.byteOffset + weightsData.byteLength
                    ),
                    format: modelJson.format,
                    generatedBy: modelJson.generatedBy,
                    convertedBy: modelJson.convertedBy,
                };
            }
        };

        model = await tf.loadLayersModel(ioHandler);
        console.log('Model loaded successfully');

        return model;
    } catch (error) {
        console.error('Error loading model:', error);
        throw new Error('Failed to load TensorFlow model');
    }
}

export async function classifyImage(imageBuffer: Buffer): Promise<{ signType: SignType; confidence: number }> {
    const model = await loadModel();

    try {
        // Use Sharp to decode and resize the image
        const sharp = (await import('sharp')).default;
        const imageData = await sharp(imageBuffer)
            .resize(224, 224)
            .removeAlpha()
            .raw()
            .toBuffer();

        // Convert buffer to Float32Array and normalize in one step
        const float32Data = new Float32Array(imageData.length);
        for (let i = 0; i < imageData.length; i++) {
            float32Data[i] = imageData[i] / 255.0;
        }

        // Create normalized tensor directly
        const imageTensor = tf.tensor4d(float32Data, [1, 224, 224, 3]);

        // Run inference
        const predictions = model.predict(imageTensor) as tf.Tensor;
        const probabilities = await predictions.data();

        // Get the class with highest probability
        const maxIndex = probabilities.indexOf(Math.max(...Array.from(probabilities)));
        const confidence = probabilities[maxIndex];

        // Clean up tensors
        imageTensor.dispose();
        predictions.dispose();

        return {
            signType: SIGN_TYPES[maxIndex],
            confidence: confidence * 100,
        };
    } catch (error) {
        console.error('Error during classification:', error);
        throw new Error('Failed to classify image');
    }
}
