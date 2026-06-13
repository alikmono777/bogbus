/**
 * Tiny structured logger. Emits single-line JSON so logs are easy to ship to
 * any aggregator, while staying dependency-free.
 */
function emit(level, msg, meta) {
  const record = { ts: new Date().toISOString(), level, msg };
  if (meta && Object.keys(meta).length) Object.assign(record, meta);
  const line = JSON.stringify(record);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG) emit('debug', msg, meta);
  },
};

export default logger;
