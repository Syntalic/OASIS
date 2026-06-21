export declare const EMBED_DIM = 384;
export declare function embedText(text: string): Promise<number[]>;
export declare function embedTexts(texts: string[], onProgress?: (done: number, total: number) => void, batchSize?: number): Promise<number[][]>;
