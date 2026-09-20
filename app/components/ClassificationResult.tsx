'use client';

import { ClassificationResult, SignType } from '@/types/classification';
import { SIGN_TYPE_LABELS } from '@/types/classification';

interface ClassificationResultProps {
    result: ClassificationResult;
}

// Quadrant of the /assets/sign_types.jpg 2x2 sprite per sign type.
const SPRITE_POSITIONS: Record<SignType, string> = {
    cabinet: '0% 0%',
    channel_letter: '100% 0%',
    flat_cut: '0% 100%',
    post_panel: '100% 100%',
};

export default function ClassificationResultComponent({ result }: ClassificationResultProps) {
    return (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-lg p-6 shadow-lg border border-blue-100 dark:border-gray-700">
            <div className="flex flex-col gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        Classification Result
                    </h3>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Sign Type:</span>
                            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                                {SIGN_TYPE_LABELS[result.signType]}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-400">Confidence:</span>
                            <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                                {result.confidence.toFixed(2)}%
                            </span>
                        </div>
                    </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Reference Image:</p>
                    <div
                        role="img"
                        aria-label={`${SIGN_TYPE_LABELS[result.signType]} reference`}
                        className="w-full aspect-[643/416] rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-md"
                        style={{
                            backgroundImage: `url(${result.imageUrl})`,
                            backgroundSize: '200% 200%',
                            backgroundPosition: SPRITE_POSITIONS[result.signType],
                            backgroundRepeat: 'no-repeat',
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
