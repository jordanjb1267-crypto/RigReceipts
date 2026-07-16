import { ScanTypeSlug } from '@/domain';

import { DEFAULT_FIXTURE, OCR_FIXTURES } from './fixtures';
import { OcrResult } from './types';

/**
 * On-device OCR with graceful degradation.
 *
 * Decision (see docs/OCR_SPIKE.md): on-device recognition via
 * `@react-native-ml-kit/text-recognition` (ML Kit on both platforms). It is a
 * native module, so it only works in a prebuilt dev/production build — not Expo
 * Go, web, or CI. Rather than hard-depend on it, the app calls
 * `recognizeDocument`, which tries the native engine and falls back to a stub
 * that returns fixture text. Every result reports which engine ran, so the UI
 * can flag when it is showing sample OCR.
 */

export interface RecognizeOptions {
  /** Force the stub (used for the onboarding demo and tests). */
  forceStub?: boolean;
  /** Which fixture the stub should return when it runs. */
  stubType?: ScanTypeSlug;
}

async function recognizeWithMlkit(imageUri: string): Promise<OcrResult> {
  // Lazy require so bundling/CI never needs the native module present.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-ml-kit/text-recognition');
  const TextRecognition = mod.default ?? mod;
  if (!TextRecognition?.recognize) {
    throw new Error('ML Kit text recognition is not linked');
  }
  const result = await TextRecognition.recognize(imageUri);
  return { text: result?.text ?? '', engine: 'mlkit' };
}

function recognizeWithStub(stubType?: ScanTypeSlug): OcrResult {
  const text = (stubType && OCR_FIXTURES[stubType]) || DEFAULT_FIXTURE;
  return { text, engine: 'stub' };
}

/**
 * Recognize text in a captured image. Never throws: if the native engine is
 * unavailable or errors, it returns stub fixture text with `engine: 'stub'`.
 */
export async function recognizeDocument(
  imageUri: string,
  options: RecognizeOptions = {},
): Promise<OcrResult> {
  if (options.forceStub) return recognizeWithStub(options.stubType);
  try {
    return await recognizeWithMlkit(imageUri);
  } catch {
    return recognizeWithStub(options.stubType);
  }
}
