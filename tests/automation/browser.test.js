const assert = require('assert');

describe('Browser Controller', function() {
  let BrowserController;

  before(function() {
    BrowserController = require('../../core/automation/browser/index');
  });

  it('should search in the background by default', async function() {
    const controller = new BrowserController({});
    let opened = false;

    controller.open = () => {
      opened = true;
      return { success: true, data: {} };
    };
    controller._searchWebInBackground = async query => ([{
      title: 'Result',
      snippet: `${query} answer`,
      url: 'https://example.com'
    }]);

    const result = await controller.search('apple wwdc');

    assert.equal(result.success, true);
    assert.equal(result.data.background, true);
    assert.equal(result.data.results[0].snippet, 'apple wwdc answer');
    assert.equal(opened, false);
  });

  it('should open the browser when explicitly requested', async function() {
    const controller = new BrowserController({});
    let openedUrl = '';

    controller.open = (url) => {
      openedUrl = url;
      return { success: true, data: { url } };
    };
    controller._searchWebInBackground = async () => {
      throw new Error('background search should not run');
    };

    const result = await controller.search('apple wwdc', { openInBrowser: true });

    assert.equal(result.success, true);
    assert.ok(openedUrl.includes('google.com/search'));
  });

  it('should enhance and extract direct answers for who-won searches', async function() {
    const controller = new BrowserController({});
    let requestedQuery = '';

    controller._searchWebInBackground = async function(query) {
      requestedQuery = this._enhanceSearchQuery(query);
      return this._rankSearchResults(query, [
        {
          title: 'Who won IPL 2026? Full list of Indian Premier League winners',
          snippet: 'Full list of Indian Premier League winners, runners-up Chennai Super Kings and Mumbai Indians are the most successful teams in the history of the IPL.'
        },
        {
          title: '2026 Indian Premier League final',
          snippet: 'It was played between Royal Challengers Bengaluru and Gujarat Titans. Bengaluru chased down Gujarat in the final.'
        },
        {
          title: 'RCB vs GT IPL 2026 Final Highlights',
          snippet: 'Royal Challengers Bengaluru retained their IPL title with a five-wicket win over Gujarat Titans.'
        }
      ]);
    };

    const result = await controller.search('who won the ipl 2026');

    assert.ok(requestedQuery.includes('winner champion final result'));
    assert.equal(result.data.answer.text, 'Royal Challengers Bengaluru (RCB) won IPL 2026, beating Gujarat Titans by five wickets.');
  });
});
