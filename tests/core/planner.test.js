const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PlannerController = require('../../core/automation/planner');

describe('Planner Controller', function() {
  it('should persist calendar and timetable entries', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-planner-'));
    const planner = new PlannerController({ app: { dataDir } });

    const calendar = planner.addCalendarEntry({
      plannerText: 'team review tomorrow at 4 pm'
    });
    const timetable = planner.addTimetableEntry({
      title: 'study block',
      dateExpression: 'today',
      timeExpression: '7:30 am'
    });

    assert.equal(calendar.success, true);
    assert.equal(calendar.data.entry.type, 'calendar');
    assert.equal(calendar.data.entry.startTime, '16:00');
    assert.equal(timetable.success, true);
    assert.equal(timetable.data.entry.type, 'timetable');
    assert.equal(timetable.data.entry.startTime, '07:30');
    assert.equal(fs.existsSync(path.join(dataDir, 'planner.json')), true);

    const restored = new PlannerController({ app: { dataDir } });
    assert.equal(restored.listEntries().data.count, 2);
  });

  it('should resolve "this" from recent conversation context', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-planner-context-'));
    const planner = new PlannerController({ app: { dataDir } });

    const result = planner.addCalendarEntry(
      { reference: 'previous', dateExpression: 'tomorrow', timeExpression: '5 pm' },
      {
        conversation: {
          recent: [
            { input: 'submit the lab form', success: false },
            { input: 'update this in calendar tomorrow at 5 pm', success: true }
          ]
        }
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.data.entry.title, 'submit the lab form');
    assert.equal(result.data.entry.startTime, '17:00');
  });

  it('should migrate accidental cwd planner data into the managed data root', function() {
    const originalCwd = process.cwd();
    const originalDataDir = process.env.OPENX_DATA_DIR;
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-cwd-planner-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-managed-planner-'));

    try {
      process.env.OPENX_DATA_DIR = dataDir;
      process.chdir(cwdDir);
      fs.writeFileSync(path.join(cwdDir, 'planner.json'), JSON.stringify([{
        id: 'planner-legacy',
        type: 'calendar',
        title: 'legacy entry',
        date: '2026-06-30',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }], null, 2), 'utf8');

      const planner = new PlannerController({
        app: { migrateCwdPlanner: true }
      });

      assert.equal(fs.existsSync(path.join(cwdDir, 'planner.json')), false);
      assert.equal(fs.existsSync(path.join(dataDir, 'planner.json')), true);
      assert.equal(planner.listEntries().data.count, 1);
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
});
