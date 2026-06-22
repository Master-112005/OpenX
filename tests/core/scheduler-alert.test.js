const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SchedulerController = require('../../core/automation/scheduler');

describe('Scheduler Alert Delivery', function() {
  it('should persist schedules and publish due events without terminal scripts', async function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-scheduler-'));
    const events = [];
    const scheduler = new SchedulerController({
      app: { dataDir, cleanupLegacySchedules: false },
      eventBus: { publish: (event, payload) => events.push({ event, payload }) }
    });

    const result = scheduler._scheduleNotification({
      kind: 'Reminder',
      title: 'Reminder',
      message: 'Review the task list',
      dueAt: new Date(Date.now() + 20)
    });

    assert.equal(result.success, true);
    assert.equal(fs.existsSync(path.join(dataDir, 'schedules.json')), true);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.message, 'Review the task list');
    assert.equal(scheduler.snooze(result.data.taskName, 5).success, true);
    assert.equal(scheduler.complete(result.data.taskName).success, true);
    scheduler.destroy();
  });
});
