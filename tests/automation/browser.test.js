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

  it('should open exactly one tab in the existing Chrome window', function() {
    const controller = new BrowserController({});
    controller.defaultBrowser = { path: 'chrome.exe', name: 'chrome' };
    controller.windowSession.listWindows = () => ([{
      handle: 100,
      id: 10,
      processName: 'chrome',
      title: 'New Tab - Google Chrome'
    }]);
    let sent = null;
    controller.windowSession.sendKeys = (windowName, keys, options) => {
      sent = { windowName, keys, options };
      return {
      success: true,
      data: { matchedWindow: 'New Tab - Google Chrome' }
      };
    };

    const result = controller.open('about:newtab', { browserName: 'chrome', newTab: true });

    assert.equal(result.success, true);
    assert.deepEqual(sent, {
      windowName: 'New Tab - Google Chrome',
      keys: '^t',
      options: { preferredProcessNames: ['chrome'] }
    });
    assert.equal(result.data.launchMethod, 'existing-window-shortcut');
    assert.equal(result.data.openedNewWindow, false);
    assert.equal(result.data.matchedWindow, 'New Tab - Google Chrome');
  });

  it('should map browser new-tab requests to native browser URLs', function() {
    const controller = new BrowserController({});

    assert.equal(controller._nativeNewTabUrl('chrome'), 'chrome://newtab/');
    assert.equal(controller._nativeNewTabUrl('edge'), 'edge://newtab/');
    assert.equal(controller._nativeNewTabUrl('firefox'), 'about:newtab');
  });

  it('should navigate a requested website in the new tab instead of leaving it blank', function() {
    const controller = new BrowserController({});
    controller.windowSession.listWindows = () => ([{
      handle: 100,
      id: 10,
      processName: 'chrome',
      title: 'Existing - Google Chrome'
    }]);
    let navigation = null;
    controller.windowSession.navigateWindowToUrl = (windowName, url, options) => {
      navigation = { windowName, url, options };
      return { success: true, data: { matchedWindow: windowName } };
    };

    const result = controller.open('https://www.youtube.com/', {
      browserName: 'chrome',
      newTab: true
    });

    assert.equal(result.success, true);
    assert.deepEqual(navigation, {
      windowName: 'Existing - Google Chrome',
      url: 'https://www.youtube.com/',
      options: { preferredProcessNames: ['chrome'], newTab: true }
    });
    assert.equal(result.data.url, 'https://www.youtube.com/');
    assert.equal(result.data.openedNewTab, true);
  });

  it('should ignore new tabs belonging to a different browser', function() {
    const controller = new BrowserController({});
    controller.defaultBrowser = { path: null, name: 'chrome' };
    controller.windowSession.listWindows = () => ([{
      handle: 100,
      id: 10,
      processName: 'msedge',
      title: 'New tab - Microsoft Edge'
    }]);

    assert.equal(controller._findBrowserWindow('chrome'), undefined);
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
    let searchedInBackground = false;
    controller._searchWebInBackground = async () => {
      searchedInBackground = true;
      return [{
        title: 'Wikipedia result',
        url: 'https://en.wikipedia.org/wiki/ChatGPT'
      }];
    };

    await controller.search('chatgpt', { openInBrowser: true });
    const result = await controller.openFirstResult();

    assert.equal(result.success, true);
    assert.equal(result.data.title, 'First Google result');
    assert.equal(result.data.googleFirstResult, true);
    assert.ok(result.data.url.includes('google.com/search?btnI=1'));
    assert.ok(result.data.url.includes('q=chatgpt'));
    assert.equal(openedUrl, result.data.url);
    assert.equal(searchedInBackground, false);
  });

  it('should use the visible Google search when opening the first link', async function() {
    const controller = new BrowserController({});
    const openedUrls = [];
    controller.open = url => {
      openedUrls.push(url);
      return { success: true, data: { url } };
    };
    controller._searchWebInBackground = async () => ([{
      title: 'Parul University - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Parul_University'
    }]);

    await controller.search('parul university', { openInBrowser: true });
    const result = await controller.openFirstResult();

    assert.equal(result.data.googleFirstResult, true);
    assert.ok(openedUrls[1].includes('google.com/search?btnI=1'));
    assert.ok(openedUrls[1].includes('q=parul%20university'));
    assert.equal(openedUrls[1].includes('wikipedia.org'), false);
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
