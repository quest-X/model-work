/** The detection and tracking protocols require an explicit terminal event. */
export async function consumeNDJSON(
    body: ReadableStream<Uint8Array>,
    onLine: (line: string) => boolean,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
        for (;;) {
            // eslint-disable-next-line no-await-in-loop -- ordered stream
            const {done, value} = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line && onLine(line)) return;
            }
            if (done) break;
        }
        if (buffer.trim() && onLine(buffer.trim())) return;
        throw new Error('推理流提前结束，未收到完成标记 / Inference stream ended before completion');
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
