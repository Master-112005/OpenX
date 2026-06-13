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

  it('should search directly inside supported sites', function() {
    const controller = new BrowserController({});
    let openedUrl = '';

    controller.open = (url) => {
      openedUrl = url;
      return { success: true, data: { url } };
    };

    const photos = controller.siteSearch('google photos', 'classmates');
    assert.equal(photos.success, true);
    assert.equal(photos.data.site, 'google photos');
    assert.equal(photos.data.query, 'classmates');
    assert.equal(openedUrl, 'https://photos.google.com/search/classmates');

    const settings = controller.siteSearch('chrome settings', 'privacy');
    assert.equal(settings.success, true);
    assert.equal(settings.data.url, 'chrome://settings/?search=privacy');
  });

  it('should open the first result from the last search query', async function() {
    const controller = new BrowserController({});
    let openedUrl = '';

    controller.open = (url) => {
      openedUrl = url;
      return { success: true, data: { url } };
    };
    controller._searchWebInBackground = async query => ([{
      title: 'ChatGPT',
      snippet: `${query} result`,
      url: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fchatgpt.com%2F'
    }]);

    await controller.search('chatgpt', { openInBrowser: true });
    const result = await controller.openFirstResult();

    assert.equal(result.success, true);
    assert.equal(result.data.title, 'ChatGPT');
    assert.equal(result.data.url, 'https://chatgpt.com/');
    assert.equal(openedUrl, 'https://chatgpt.com/');
  });

  it('should open trusted web app URLs instead of blindly opening the first search result', async function() {
    const controller = new BrowserController({});
    let openedUrl = '';
    let searched = false;

    controller.open = (url) => {
      openedUrl = url;
      return { success: true, data: { url } };
    };
    controller._searchWebInBackground = async () => {
      searched = true;
      return [{
        title: 'Google Photos - Wikipedia',
        snippet: 'Wikipedia result',
        url: 'https://en.wikipedia.org/wiki/Google_Photos'
      }];
    };

    const photos = await controller.openFirstResult('google photos');
    const photosApp = await controller.openFirstResult('google photos app');
    const mail = await controller.openFirstResult('gmail');
    const colab = await controller.openFirstResult('google colab');

    assert.equal(photos.data.url, 'https://photos.google.com/');
    assert.equal(photosApp.data.url, 'https://photos.google.com/');
    assert.equal(mail.data.url, 'https://mail.google.com/');
    assert.equal(colab.data.url, 'https://colab.research.google.com/');
    assert.equal(openedUrl, 'https://colab.research.google.com/');
    assert.equal(searched, false);
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

    assert.ok(requestedQuery.includes('IPL cricket final winner champion result'));
    assert.equal(result.data.answer.text, 'Royal Challengers Bengaluru (RCB) won IPL 2026, beating Gujarat Titans by five wickets.');
  });

  it('should avoid direct winner answers when search results do not provide evidence', async function() {
    const controller = new BrowserController({});
    let requestedQuery = '';

    controller._searchWebInBackground = async function(query) {
      requestedQuery = this._enhanceSearchQuery(query);
      return [];
    };

    const result = await controller.search('who is the winner of ipl 2026');

    assert.ok(requestedQuery.includes('IPL cricket final winner champion result'));
    assert.equal(result.data.answer, null);
  });

  it('should not use winner snippets that do not match the requested year', async function() {
    const controller = new BrowserController({});

    controller._searchWebInBackground = async function(query) {
      return this._rankSearchResults(query, [
        {
          title: 'FIFA World Cup winners list',
          snippet: 'Argentina won the FIFA World Cup 2022 final.'
        }
      ]);
    };

    const result = await controller.search('who won the fifa world cup 2020');

    assert.equal(result.data.answer, null);
  });

  it('should extract direct answers for older IPL winner questions', async function() {
    const controller = new BrowserController({});
    let requestedQuery = '';

    controller._searchWebInBackground = async function(query) {
      requestedQuery = this._enhanceSearchQuery(query);
      return [];
    };

    const result = await controller.search('which team is the winner of ipl 2020');
    const result2011 = await controller.search('who won the ipl 2011');
    const result2021 = await controller.search('who won the ipl 2021');
    const result2022 = await controller.search('who won the ipl 2022');

    assert.ok(requestedQuery.includes('IPL cricket final winner champion result'));
    assert.equal(result.data.answer.text, 'Mumbai Indians won IPL 2020.');
    assert.equal(result2011.data.answer.text, 'Chennai Super Kings won IPL 2011.');
    assert.equal(result2021.data.answer.text, 'Chennai Super Kings won IPL 2021.');
    assert.equal(result2022.data.answer.text, 'Gujarat Titans won IPL 2022.');
  });

  it('should prefer instant answers before generic search snippets', async function() {
    const controller = new BrowserController({});

    controller._searchInstantAnswer = async () => ([{
      title: 'Dune',
      snippet: 'Dune: Part Three is scheduled to be released on December 18, 2026.',
      url: 'https://example.com/dune',
      source: 'duckduckgo-instant-answer',
      answerText: 'Dune: Part Three is scheduled to be released on December 18, 2026.',
      score: 100
    }]);
    controller._searchDuckDuckGoHtml = async () => ([{
      title: 'Unrelated result',
      snippet: 'This page has a long history of Dune adaptations.'
    }]);

    const result = await controller.search('what is the dune 3 release date');

    assert.equal(result.data.answer.text, 'Dune: Part Three is scheduled to be released on December 18, 2026.');
    assert.equal(result.data.results[0].source, 'duckduckgo-instant-answer');
  });

  it('should extract release-date answers from ranked result snippets', async function() {
    const controller = new BrowserController({});

    controller._searchInstantAnswer = async () => [];
    controller._searchDuckDuckGoHtml = async function(query) {
      return this._rankSearchResults(query, [
        {
          title: 'Dune: Part Three release date confirmed',
          snippet: 'Warner Bros. has scheduled Dune: Part Three to release in theaters on December 18, 2026.'
        },
        {
          title: 'Dune novels explained',
          snippet: 'A guide to the books and characters in the Dune universe.'
        }
      ]);
    };

    const result = await controller.search('what is the dune 3 release date');

    assert.equal(result.data.answer.text, 'Warner Bros. has scheduled Dune: Part Three to release in theaters on December 18, 2026.');
  });

  it('should enhance and answer schedule and best-movie searches from snippets', async function() {
    const controller = new BrowserController({});
    const requested = [];

    controller._searchInstantAnswer = async () => [];
    controller._searchDuckDuckGoHtml = async function(query) {
      requested.push(this._enhanceSearchQuery(query));
      return this._rankSearchResults(query, [
        {
          title: query.includes('fifa') ? 'FIFA World Cup 2026 match schedule' : 'Tom Cruise movies ranked',
          snippet: query.includes('fifa')
            ? 'The FIFA World Cup schedule lists group-stage matches from June 11, 2026, with fixtures organized by date and venue.'
            : 'Top Tom Cruise movies include Mission: Impossible - Fallout, Top Gun: Maverick, Edge of Tomorrow, and Magnolia.'
        }
      ]);
    };

    const schedule = await controller.search('fifa world cup match list');
    const movies = await controller.search('what is the tom cruise best movies');

    assert.ok(requested[0].includes('schedule fixtures'));
    assert.ok(requested[1].includes('ranked list'));
    assert.match(schedule.data.answer.text, /FIFA World Cup schedule/);
    assert.match(movies.data.answer.text, /Top Tom Cruise movies/);
  });
});
