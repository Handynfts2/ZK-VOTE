// Streams a URL (e.g. a ZK circuit artifact) and reports download progress.
// Used to show a progress indicator while downloading the multi-megabyte
// vote_final.zkey proving key, which is the main bottleneck for proof
// generation UX (see #192).

export interface DownloadProgress {
  loadedBytes: number;
  totalBytes: number;
}

export async function fetchWithProgress(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    // Streaming not supported (e.g. some test environments) — fall back to
    // a single-shot download with a single progress callback.
    const buffer = await response.arrayBuffer();
    onProgress?.({
      loadedBytes: buffer.byteLength,
      totalBytes: buffer.byteLength,
    });
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress?.({ loadedBytes, totalBytes: totalBytes || loadedBytes });
    }
  }

  const result = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
