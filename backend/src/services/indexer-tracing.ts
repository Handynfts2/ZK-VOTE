/** Lightweight W3C-compatible tracing for one complete indexer cycle. */

import { randomBytes } from "node:crypto";

export type SpanAttributes = Record<string, boolean | number | string>;

export interface IndexerSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: "01";
}

export interface ExportedIndexerSpan extends IndexerSpanContext {
  name: string;
  parentSpanId?: string;
  traceparent: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  attributes: SpanAttributes;
  error?: string;
}

export interface IndexerSpanExporter {
  export(span: ExportedIndexerSpan): Promise<void> | void;
}

const noopExporter: IndexerSpanExporter = { export: () => undefined };
let activeExporter: IndexerSpanExporter = noopExporter;

export function setIndexerSpanExporter(
  exporter: IndexerSpanExporter | null,
): void {
  activeExporter = exporter ?? noopExporter;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function exportSpan(span: ExportedIndexerSpan): Promise<void> {
  try {
    await activeExporter.export(span);
  } catch {
    // Telemetry must never make the indexer fail or replay a ledger range.
  }
}

export async function withIndexerSpan<T>(
  name: string,
  parent: IndexerSpanContext | null,
  attributes: SpanAttributes,
  operation: (context: IndexerSpanContext) => Promise<T> | T,
): Promise<T> {
  const context: IndexerSpanContext = {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    traceFlags: "01",
  };
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  let status: ExportedIndexerSpan["status"] = "ok";
  let errorMessage: string | undefined;

  try {
    return await operation(context);
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
    await exportSpan({
      ...context,
      name,
      parentSpanId: parent?.spanId,
      traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags}`,
      startedAt: startedAt.toISOString(),
      durationMs,
      status,
      attributes,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  }
}
