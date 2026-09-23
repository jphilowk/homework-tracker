// Run only on a trusted GitHub Actions runner. The secret is never written to disk.
// The public workflow log contains only these fixed messages, not student data.
import { fetchCanvasSnapshot, safeCanvasError } from '../backend/canvas.mjs';

try {
  const snapshot = await fetchCanvasSnapshot({ token: process.env.CANVAS_TOKEN });
  console.log('Canvas authentication and complete assignment fetch succeeded.');
  console.log(snapshot.courseCount ? 'Active student courses are available.' : 'No active student courses were returned.');
  console.log(snapshot.items.some(item => item.dueAt) ? 'Dated assignments are available for import.' : 'No dated assignments were returned.');
  console.log(snapshot.items.some(item => item.submission === 'submitted') ? 'Student submission evidence is available.' : 'No confirmed submission evidence was returned; Daybook completion will be preserved.');
} catch (error) {
  const safe = safeCanvasError(error);
  console.error(`Canvas check failed [${safe.code}]: ${safe.message}`);
  process.exitCode = 1;
}
