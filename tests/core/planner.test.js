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
});
