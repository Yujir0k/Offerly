"use client";
import type { ArtifactType } from "../vendor/fsp-assessment/src/generative/model";
import type { ReactNode } from "react";

type VisibleArtifact = {
  id: string;
  type?: ArtifactType;
  label: string;
  content: string | null;
};
const format = (value: unknown): string =>
  typeof value === "boolean"
    ? value
      ? "Да"
      : "Нет"
    : value === null
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function ObservationTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <div className="artifact-table-scroll">
      <table className="artifact-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{format(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Reader = (data: Record<string, unknown>) => ReactNode;
function ProfessionalEvidence(data: Record<string, unknown>) {
  const rows = (input: unknown) =>
    Array.isArray(input)
      ? input
          .map(object)
          .filter((row): row is Record<string, unknown> => Boolean(row))
      : [];
  const labels: Record<string, string> = {
    source: "Измерение",
    scope: "Сегмент",
    version: "Версия / выборка",
    observed: "Наблюдение",
    reference: "Контракт",
  };
  const translated = (input: unknown) =>
    rows(input).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [labels[key] || key, value]),
      ),
    );
  return (
    <div className="professional-evidence">
      <p className="artifact-observation">
        Измерения: {format(data.timestamp)} · {format(data.scope)}
      </p>
      <ObservationTable rows={translated(data.records)} />
      {Array.isArray(data.controlRecords) && data.controlRecords.length > 0 && (
        <details>
          <summary>Контрольный сегмент</summary>
          <ObservationTable rows={translated(data.controlRecords)} />
        </details>
      )}
      {typeof data.aggregate === "string" && (
        <p className="artifact-observation">{data.aggregate}</p>
      )}
    </div>
  );
}
/** Artifact readers are registered by evidence format, independently of professional role. */
const evidenceReaders: Partial<Record<ArtifactType, Reader>> =
  Object.fromEntries(
    [
      "logs",
      "metrics",
      "trace",
      "network",
      "deployment",
      "table",
      "schema",
      "dag",
      "dom",
      "accessibility_tree",
      "test_run",
      "ci_log",
      "model_metrics",
      "feature_distribution",
      "experiment_table",
      "security_policy",
      "http_exchange",
      "lifecycle",
      "crash_report",
      "retrieval_results",
      "tool_trace",
      "model_registry",
      "lineage",
      "code_diff",
      "timeline",
    ].map((type) => [type, ProfessionalEvidence]),
  );

/** Visible evidence has dedicated readers; this component receives no scoring or hidden payload. */
export function AssessmentArtifact({
  artifact,
}: {
  artifact: VisibleArtifact;
}) {
  if (artifact.content === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.content);
  } catch {
    parsed = null;
  }
  const data = object(parsed);
  const reader = artifact.type ? evidenceReaders[artifact.type] : undefined;
  if (data?.format === "professional-observations-v1" && reader)
    return <div data-artifact-type={artifact.type}>{reader(data)}</div>;
  if (artifact.type === "code" || artifact.type === "diff")
    return (
      <div className="artifact-code" data-artifact-type={artifact.type}>
        <div className="artifact-toolbar">
          {artifact.type === "diff"
            ? "Предлагаемое изменение"
            : "Контекстный фрагмент кода"}
        </div>
        <pre>
          {artifact.content.split("\n").map((line, index) => (
            <span
              className={`code-line ${line.startsWith("+") ? "code-added" : line.startsWith("-") ? "code-removed" : ""}`}
              key={index}
            >
              <span className="code-number" aria-hidden="true">
                {index + 1}
              </span>
              <code>
                {line
                  .split(
                    /\b(const|await|async|return|if|try|finally|catch|throw)\b/g,
                  )
                  .map((token, part) => (
                    <span
                      className={
                        /^(const|await|async|return|if|try|finally|catch|throw)$/.test(
                          token,
                        )
                          ? "code-keyword"
                          : undefined
                      }
                      key={part}
                    >
                      {token}
                    </span>
                  )) || " "}
              </code>
            </span>
          ))}
        </pre>
      </div>
    );
  if (artifact.type === "logs" || artifact.type === "console")
    return (
      <div className="artifact-log" data-artifact-type={artifact.type}>
        <div className="artifact-toolbar">{artifact.label}</div>
        <pre>{artifact.content}</pre>
      </div>
    );
  if (artifact.type === "metrics" && data) {
    const metrics = Object.entries(data).filter(
      ([, value]) => typeof value === "number",
    );
    return (
      <div className="artifact-metrics" data-artifact-type="metrics">
        <div className="metric-grid">
          {metrics.map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <strong>
                {format(value)}
                {name.endsWith("Ms")
                  ? " мс"
                  : name.endsWith("Seconds")
                    ? " с"
                    : ""}
              </strong>
            </div>
          ))}
        </div>
        {typeof data.observation === "string" && (
          <p className="artifact-observation">{data.observation}</p>
        )}
      </div>
    );
  }
  if (artifact.type === "trace" && data && Array.isArray(data.spans)) {
    const spans = data.spans
      .map(object)
      .filter((span): span is Record<string, unknown> => Boolean(span));
    const end = Math.max(
      1,
      ...spans.map((span) => Number(span.startMs) + Number(span.durationMs)),
    );
    return (
      <div className="artifact-trace" data-artifact-type="trace">
        {typeof data.scope === "string" && (
          <p className="artifact-observation">{data.scope}</p>
        )}
        <p className="artifact-scale">Шкала: 0–{end} мс</p>
        {spans.map((span, index) => (
          <div className="trace-row" key={index}>
            <span>{format(span.node)}</span>
            <div className="trace-track">
              <i
                style={{
                  left: `${(Number(span.startMs) / end) * 100}%`,
                  width: `${Math.max(1, (Number(span.durationMs) / end) * 100)}%`,
                }}
              />
            </div>
            <small>{format(span.durationMs)} мс</small>
          </div>
        ))}
        {typeof data.observation === "string" && (
          <p className="artifact-observation">{data.observation}</p>
        )}
      </div>
    );
  }
  const records = Array.isArray(parsed)
    ? parsed
    : data && (data.records || data.timeline || data.state);
  if (records && (Array.isArray(records) || object(records))) {
    const rows = Array.isArray(records)
      ? records
          .map(object)
          .filter((row): row is Record<string, unknown> => Boolean(row))
      : Object.entries(object(records)!).map(([name, value]) => ({
          name,
          value,
        }));
    return (
      <div data-artifact-type={artifact.type}>
        {data && (
          <div className="artifact-facts">
            {Object.entries(data)
              .filter(
                ([key, value]) =>
                  ["string", "number", "boolean"].includes(typeof value) &&
                  key !== "observation",
              )
              .map(([key, value]) => (
                <span key={key}>
                  {key}: <b>{format(value)}</b>
                </span>
              ))}
          </div>
        )}
        <ObservationTable rows={rows} />
        {typeof data?.observation === "string" && (
          <p className="artifact-observation">{data.observation}</p>
        )}
      </div>
    );
  }
  if (artifact.type === "chart" && data && Array.isArray(data.series))
    return (
      <div className="artifact-chart" data-artifact-type="chart">
        {data.series
          .map(object)
          .filter((series): series is Record<string, unknown> =>
            Boolean(series),
          )
          .map((series, index) => (
            <div key={index}>
              <strong>{format(series.name)}</strong>
              <div>
                {Array.isArray(series.points) &&
                  series.points.map((point, i) => (
                    <span
                      key={i}
                      style={{
                        height: `${Math.max(12, Math.min(80, (Number(point) / Math.max(...(series.points as unknown[]).map(Number), 1)) * 80))}px`,
                      }}
                      title={String(point)}
                    />
                  ))}
              </div>
              <small>{format(series.points)}</small>
            </div>
          ))}
      </div>
    );
  if (data)
    return (
      <ObservationTable
        rows={Object.entries(data).map(([name, value]) => ({ name, value }))}
      />
    );
  return (
    <pre className="artifact-raw" data-artifact-type={artifact.type}>
      {artifact.content}
    </pre>
  );
}

/** Legacy snapshots retain their prose; new snapshots expose authored, structured sections. */
export function AssessmentScenario({
  scenario,
  context,
}: {
  scenario?: {
    context: string;
    observations: string[];
    constraints: string[];
    assumptions: string[];
  };
  context: string;
}) {
  if (!scenario)
    return (
      <div className="scenario-context">
        {context.split(/\n\n+/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    );
  return (
    <div className="scenario-sections">
      <section>
        <h2>Контекст</h2>
        <p>{scenario.context}</p>
      </section>
      <section className="scenario-observations">
        <h2>Наблюдения</h2>
        <ul>
          {scenario.observations.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      {scenario.constraints.length + scenario.assumptions.length > 0 && (
        <section>
          <h2>Ограничения</h2>
          <ul>
            {[...scenario.assumptions, ...scenario.constraints].map(
              (text, index) => (
                <li key={index}>{text}</li>
              ),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
