import { APP_VERSION } from '../../constants/version';
import { HealthController } from './health.controller';

// ⚠️ No `Test.createTestingModule`, no `DatabaseModule`, no database. A unit test
// that cannot run without infrastructure is a test that stops being run.
describe('HealthController', () => {
  const controller = new HealthController();

  it('reports ok and the running version', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.version).toBe(APP_VERSION);
  });

  it('timestamps in UTC ISO-8601', () => {
    const before = Date.now();
    const { time } = controller.check();

    expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(time)).toBeGreaterThanOrEqual(before);
  });
});
