import { NextRequest, NextResponse } from 'next/server';
import { classifyImage } from '@/lib/modelLoader';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;

        if (!file) {
            return NextResponse.json(
                { error: 'No image file provided' },
                { status: 400 }
            );
        }

        // Check file type
        if (!file.type.startsWith('image/')) {
            return NextResponse.json(
                { error: 'File must be an image (jpg or png)' },
                { status: 400 }
            );
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Classify the image
        const { signType, confidence } = await classifyImage(buffer);

        // Return classification result
        return NextResponse.json({
            signType,
            confidence: Math.round(confidence * 100) / 100,
            imageUrl: '/assets/sign_types.jpg',
        });
    } catch (error) {
        console.error('Classification error:', error);
        return NextResponse.json(
            { error: 'Failed to classify image. Please try again.' },
            { status: 500 }
        );
    }
}
