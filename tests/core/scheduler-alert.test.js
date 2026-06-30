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

  it('should use OpenX schedule names and migrate accidental cwd schedules', function() {
    const originalCwd = process.cwd();
    const originalDataDir = process.env.OPENX_DATA_DIR;
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-cwd-schedules-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-managed-schedules-'));

    try {
      process.env.OPENX_DATA_DIR = dataDir;
      process.chdir(cwdDir);
      fs.writeFileSync(path.join(cwdDir, 'schedules.json'), JSON.stringify([{
        id: 'JARVIS_Reminder_legacy',
        taskName: 'JARVIS_Reminder_legacy',
        kind: 'Reminder',
        title: 'JARVIS Reminder Reminder',
        message: 'legacy reminder',
        dueAt: new Date(Date.now() + 60000).toISOString(),
        status: 'scheduled',
        createdAt: new Date().toISOString()
      }], null, 2), 'utf8');

      const scheduler = new SchedulerController({
        app: { cleanupLegacySchedules: false, migrateCwdSchedules: true }
      });
      const result = scheduler.setReminder('call mummy', { duration: 30 });
      const entries = JSON.parse(fs.readFileSync(path.join(dataDir, 'schedules.json'), 'utf8'));

      assert.equal(result.success, true);
      assert.equal(fs.existsSync(path.join(cwdDir, 'schedules.json')), false);
      assert.ok(entries.every(item => !String(item.id).startsWith('JARVIS_')));
      assert.ok(entries.every(item => !String(item.taskName).startsWith('JARVIS_')));
      assert.ok(entries.every(item => !/^JARVIS\b/.test(String(item.title || ''))));
      assert.ok(entries.some(item => item.id === 'OpenX_Reminder_legacy'));
      assert.ok(entries.some(item => item.title === 'OpenX Reminder'));
      assert.match(result.data.id, /^OpenX_Reminder_/);
      assert.equal(result.data.title, 'OpenX Reminder');
      scheduler.destroy();
    } finally {
      process.chdir(originalCwd);
      if (originalDataDir === undefined) {
        delete process.env.OPENX_DATA_DIR;
      } else {
        process.env.OPENX_DATA_DIR = originalDataDir;
      }
      fs.rmSync(cwdDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('should classify reminders and persist category symbols', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-reminder-category-'));
    const scheduler = new SchedulerController({
      app: { dataDir, cleanupLegacySchedules: false },
      eventBus: { publish() {} }
    });

    const college = scheduler.setReminder('go to college', { duration: 10 });
    const water = scheduler.setReminder('drink water', { duration: 20 });
    const exercise = scheduler.setReminder('do my exercise', { duration: 30 });

    assert.equal(college.data.category, 'education');
    assert.equal(college.data.symbol, '🎓');
    assert.equal(water.data.category, 'water');
    assert.equal(water.data.symbol, '💧');
    assert.equal(exercise.data.category, 'exercise');
    assert.equal(exercise.data.symbol, '🏃');
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'schedules.json'), 'utf8'));
    assert.deepEqual(persisted.map(item => item.category), ['education', 'water', 'exercise']);
    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('should understand spoken clock expressions', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-spoken-clock-'));
    const scheduler = new SchedulerController({ app: { dataDir, cleanupLegacySchedules: false } });

    assert.ok(scheduler._parseTimeExpression('seven am') instanceof Date);
    assert.ok(scheduler._parseTimeExpression('noon') instanceof Date);
    assert.ok(scheduler._parseTimeExpression('midnight') instanceof Date);
    assert.ok(scheduler._parseTimeExpression('half past seven') instanceof Date);
    assert.ok(scheduler._parseTimeExpression('quarter to eight') instanceof Date);

    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('should manage active timers alarms and schedule lists', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-schedule-management-'));
    const scheduler = new SchedulerController({ app: { dataDir, cleanupLegacySchedules: false } });

    scheduler.setTimer(5);
    assert.equal(scheduler.pauseActiveTimer().success, true);
    assert.equal(scheduler.resumeActiveTimer().success, true);
    assert.equal(scheduler.getRemainingTimer().data.remainingMinutes, 5);
    assert.equal(scheduler.listSchedules('Timer').data.count, 1);
    assert.equal(scheduler.resetActiveTimer().success, true);
    assert.equal(scheduler.cancelLatest('Timer').success, true);
    scheduler.setAlarm('noon', 'Lunch');
    assert.equal(scheduler.listSchedules('Alarm').data.entries[0].alarmLabel, 'Lunch');
    assert.equal(scheduler.snoozeLatestAlarm().success, true);
    assert.equal(scheduler.clearSchedules('Alarm').data.count, 1);
    scheduler.setReminder('drink water', { duration: 15 });
    assert.equal(scheduler.snoozeLatestReminder(10).success, true);

    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('should expose timer and stopwatch state for the mini widget', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-timer-widget-'));
    const scheduler = new SchedulerController({ app: { dataDir, cleanupLegacySchedules: false } });

    const timer = scheduler.setTimer(5);
    assert.equal(timer.success, true);
    const timerState = scheduler.getTimerWidgetState(timer.data.taskName);
    assert.equal(timerState.visible, true);
    assert.equal(timerState.mode, 'timer');
    assert.equal(timerState.durationMs, 300000);
    assert.ok(timerState.remainingMs > 0);
    scheduler.cancelLatest('Timer');

    const stopwatch = scheduler.startStopwatch();
    assert.equal(stopwatch.success, true);
    assert.equal(scheduler.getTimerWidgetState(stopwatch.data.taskName).visible, false);
    const stopwatchState = scheduler.getTimerWidgetState(stopwatch.data.taskName, { includeStopwatch: true });
    assert.equal(stopwatchState.visible, true);
    assert.equal(stopwatchState.mode, 'stopwatch');
    assert.equal(stopwatchState.status, 'running');
    assert.ok(stopwatchState.elapsedMs >= 0);
    assert.equal(scheduler.pauseStopwatch().success, true);
    assert.equal(scheduler.resetStopwatch().data.status, 'paused');
    assert.equal(scheduler.getTimerWidgetState(stopwatch.data.taskName, { includeStopwatch: true }).elapsedMs, 0);
    assert.equal(scheduler.resumeStopwatch().data.status, 'running');
    assert.equal(scheduler.stopStopwatch().success, true);
    assert.equal(scheduler.getTimerWidgetState().visible, false);

    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('should not let an active stopwatch appear from timer or alarm widget polling', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-stopwatch-isolation-'));
    const scheduler = new SchedulerController({ app: { dataDir, cleanupLegacySchedules: false } });

    const stopwatch = scheduler.startStopwatch();
    assert.equal(stopwatch.success, true);
    assert.equal(scheduler.getTimerWidgetState().visible, false);
    assert.equal(scheduler.getTimerWidgetState(null, { includeStopwatch: true }).mode, 'stopwatch');

    const timer = scheduler.setTimer(5);
    assert.equal(timer.success, true);
    assert.equal(scheduler.getTimerWidgetState().mode, 'timer');
    scheduler.complete(timer.data.id);
    assert.equal(scheduler.getTimerWidgetState().visible, false);

    const alarm = scheduler.setAlarm('noon', 'Lunch');
    assert.equal(alarm.success, true);
    assert.equal(scheduler.getTimerWidgetState(alarm.data.id).visible, false);

    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('should persist and roll recurring reminders forward', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-recurring-reminder-'));
    const scheduler = new SchedulerController({ app: { dataDir, cleanupLegacySchedules: false } });
    const result = scheduler.setReminder('drink water', { recurrence: 'hourly' });
    const firstDueAt = result.data.dueAt;

    assert.equal(result.success, true);
    assert.equal(scheduler.scheduledItems[0].recurrence, 'hourly');
    scheduler.complete(result.data.taskName);
    assert.equal(scheduler.scheduledItems[0].status, 'scheduled');
    assert.ok(new Date(scheduler.scheduledItems[0].dueAt) > new Date(firstDueAt));

    scheduler.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
