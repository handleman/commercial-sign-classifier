'use client';

import { useState, useRef, useEffect } from 'react';
import { Message, ClassificationResult } from '@/types/classification';
import ClassificationResultComponent from './ClassificationResult';
import Image from 'next/image';

export default function ChatInterface() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async () => {
        if (!selectedFile) return;

        setIsLoading(true);

        // Add user message with uploaded image
        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            imageUrl: previewUrl || undefined,
            timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        try {
            const formData = new FormData();
            formData.append('image', selectedFile);

            const response = await fetch('/api/classify', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Classification failed');
            }

            const result: ClassificationResult = await response.json();

            // Add assistant message with classification result
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                classification: result,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
            console.error('Error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: 'Sorry, I encountered an error while classifying your image. Please try again.',
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
            setSelectedFile(null);
            setPreviewUrl(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleClear = () => {
        setSelectedFile(null);
        setPreviewUrl(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 rounded-t-lg shadow-md p-6 border-b border-gray-200 dark:border-gray-700">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                    Sign Classifier
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Upload an image of a sign to identify its type
                </p>
            </div>

            {/* Messages Area */}
            <div className="flex-1 bg-gray-50 dark:bg-gray-900 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center py-12">
                        <div className="text-6xl mb-4">🏷️</div>
                        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Welcome to Sign Classifier
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 mb-4">
                            Upload an image to get started
                        </p>
                        <div className="text-sm text-gray-400 dark:text-gray-500 space-y-1">
                            <p>Supported types: Flat Cut, Cabinet, Channel Letter, Post Panel</p>
                            <p>Formats: JPG, PNG</p>
                        </div>
                    </div>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-2xl ${message.type === 'user'
                                    ? 'bg-blue-500 text-white rounded-lg p-4'
                                    : 'w-full'
                                }`}
                        >
                            {message.type === 'user' && message.imageUrl && (
                                <div className="relative w-full h-64 rounded-lg overflow-hidden">
                                    <Image
                                        src={message.imageUrl}
                                        alt="Uploaded sign"
                                        fill
                                        className="object-contain"
                                    />
                                </div>
                            )}
                            {message.type === 'assistant' && message.classification && (
                                <ClassificationResultComponent result={message.classification} />
                            )}
                            {message.type === 'assistant' && message.content && (
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
                                    <p className="text-gray-800 dark:text-gray-200">{message.content}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
                            <div className="flex items-center space-x-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                                <span className="text-gray-600 dark:text-gray-400">Classifying image...</span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white dark:bg-gray-800 rounded-b-lg shadow-md p-4 border-t border-gray-200 dark:border-gray-700">
                {previewUrl && (
                    <div className="mb-4 relative">
                        <div className="relative w-full h-48 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
                            <Image
                                src={previewUrl}
                                alt="Preview"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <button
                            onClick={handleClear}
                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-2 hover:bg-red-600 transition-colors"
                            aria-label="Clear image"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/jpg"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-input"
                    />
                    <label
                        htmlFor="file-input"
                        className="flex-1 cursor-pointer bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-4 py-3 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fillRule="evenodd"
                                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                                clipRule="evenodd"
                            />
                        </svg>
                        {selectedFile ? selectedFile.name : 'Choose an image...'}
                    </label>
                    <button
                        onClick={handleSubmit}
                        disabled={!selectedFile || isLoading}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${selectedFile && !isLoading
                                ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl'
                                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {isLoading ? 'Processing...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}
