export type SignType = 'flat_cut' | 'cabinet' | 'channel_letter' | 'post_panel';

export interface ClassificationResult {
    signType: SignType;
    confidence: number;
    imageUrl: string;
}

export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content?: string;
    imageUrl?: string;
    classification?: ClassificationResult;
    timestamp: Date;
}

export const SIGN_TYPES: SignType[] = ['cabinet', 'channel_letter', 'flat_cut', 'post_panel'];

export const SIGN_TYPE_LABELS: Record<SignType, string> = {
    flat_cut: 'Flat Cut',
    cabinet: 'Cabinet',
    channel_letter: 'Channel Letter',
    post_panel: 'Post Panel',
};
