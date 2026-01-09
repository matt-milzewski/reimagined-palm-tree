type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export function log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context
  };

  console.log(JSON.stringify(entry));
}
