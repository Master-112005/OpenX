const Normalizer = require('../Data').Normalizer;
const {
  DOMAIN_VOCABULARY,
  FILLER_WORDS,
  LEAD_IN_PATTERNS,
  PHRASE_REPLACEMENTS,
  TOKEN_CORRECTIONS,
  TOKEN_SEQUENCE_REPLACEMENTS
} = (() => {
const FILLER_WORDS = new Set([
  'a',
  'actually',
  'an',
  'assistant',
  'before',
  'basically',
  'boss',
  'but',
  'can',
  'commander',
  'could',
  'do',
  'during',
  'for',
  'hey',
  'i',
  'openx',
  'jarvis',
  'just',
  'kindly',
  'literally',
  'maybe',
  'master',
  'me',
  'mind',
  'my',
  'now',
  'okay',
  'ok',
  'only',
  'please',
  'pls',
  'saying',
  'sir',
  'simply',
  'so',
  'talking',
  'the',
  'this',
  'to',
  'uh',
  'um',
  'while',
  'what',
  'is',
  'are',
  'was',
  'were',
  'would',
  'you'
]);

const LEAD_IN_PATTERNS = [
  /^(?:please\s+)+/i,
  /^(?:do\s+one\s+thing\s+)+/i,
  /^(?:one\s+thing\s+)+/i,
  /^(?:can|could|would|will)\s+you\s+/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:(?:do\s+one\s+thing|go\s+ahead)\s+and\s+)?/i,
  /^(?:would\s+you\s+mind\s+)+/i,
  /^(?:i\s+need\s+you\s+to|i\s+want\s+you\s+to|i\s+am\s+telling\s+you\s+to)\s+/i,
  /^(?:go\s+ahead\s+and|kindly|just)\s+/i,
  /^(?:hey\s+)?(?:openx|jarvis|assistant)\s+/i
];

const PHRASE_REPLACEMENTS = [
  { from: /\bun\s+mute\b/g, to: 'unmute' },
  { from: /\b(?:fresh|another|one\s+more)\s+chrome\s+tab\b/g, to: 'new chrome tab' },
  { from: /\b(?:fresh|another|one\s+more)\s+tab\b/g, to: 'new tab' },
  { from: /\bturn it up\b/g, to: 'increase volume' },
  { from: /\bturn it down\b/g, to: 'decrease volume' },
  { from: /\bmake it louder\b/g, to: 'increase volume' },
  { from: /\bmake volume louder\b/g, to: 'increase volume' },
  { from: /\braise volume\b/g, to: 'increase volume' },
  { from: /\bvolume higher\b/g, to: 'increase volume' },
  { from: /\bmake it quieter\b/g, to: 'decrease volume' },
  { from: /\blower volume\b/g, to: 'decrease volume' },
  { from: /\bvolume lower\b/g, to: 'decrease volume' },
  { from: /\bmake it brighter\b/g, to: 'increase brightness' },
  { from: /\bmake (?:the )?screen brighter\b/g, to: 'increase brightness' },
  { from: /\braise brightness\b/g, to: 'increase brightness' },
  { from: /\bbrightness higher\b/g, to: 'increase brightness' },
  { from: /\bmake it dimmer\b/g, to: 'decrease brightness' },
  { from: /\bmake (?:the )?screen (?:darker|dimmer)\b/g, to: 'decrease brightness' },
  { from: /\blower brightness\b/g, to: 'decrease brightness' },
  { from: /\breduce brightness\b/g, to: 'decrease brightness' },
  { from: /\bbrightness lower\b/g, to: 'decrease brightness' },
  { from: /\bshut down\b/g, to: 'shutdown' },
  { from: /\bclose down\b/g, to: 'close' },
  { from: /\bexit out of\b/g, to: 'close' },
  { from: /\bget rid of\b/g, to: 'close' },
  { from: /\blook for\b/g, to: 'find' },
  { from: /\btell (?:me )?about (?:this|my|the) (?:laptop|pc|computer|system)\b/g, to: 'system status' },
  { from: /\bgive me details (?:about|of) (?:this|my|the) (?:laptop|pc|computer|system)\b/g, to: 'system status' },
  { from: /\btell me about\b/g, to: 'search for' },
  { from: /\btell about\b/g, to: 'search for' },
  { from: /\bgive me details (?:about|of)\b/g, to: 'search for' },
  { from: /\bwhat all\b/g, to: 'what' },
  { from: /\bwhich all\b/g, to: 'which' },
  { from: /\bset\s+(?:a\s+)?reminder\s+t\s+(\d)/g, to: 'set reminder at $1' },
  { from: /\bdo one thing and\b/g, to: '' },
  { from: /\bdo one thing\b/g, to: '' },
  { from: /\bone thing\b/g, to: '' },
  { from: /\bsearch up\b/g, to: 'search for' },
  { from: /\bsearch about\b/g, to: 'search for' },
  { from: /\bgoogle about\b/g, to: 'google' },
  { from: /\bclick first\b/g, to: 'click the first' },
  { from: /\bopen first\b/g, to: 'open the first' },
  { from: /\bwhere i the\b/g, to: 'where is the' },
  { from: /\bwhere i\b/g, to: 'where is' },
  { from: /\bopen up\b/g, to: 'open' },
  { from: /\bbring up\b/g, to: 'open' },
  { from: /\bpull up\b/g, to: 'open' },
  { from: /\bfire up\b/g, to: 'open' },
  { from: /\bbring to front\b/g, to: 'switch to' },
  { from: /\bswitch over to\b/g, to: 'switch to' },
  { from: /\bmake\s+(.+?)\s+(?:bigger|larger)\b/g, to: 'maximize $1' },
  { from: /\bmake\s+(.+?)\s+(?:smaller|hidden)\b/g, to: 'minimize $1' },
  { from: /\bhide\s+(.+?)\s+window\b/g, to: 'minimize $1' },
  { from: /\bcollapse\s+all\s+folders\b/g, to: 'minimize all windows' },
  { from: /\bexpand\s+all\s+folders\b/g, to: 'maximize all windows' },
  { from: /\bput\s+(?:the\s+)?(volume|sound|audio|brightness)\s+(?:at|to|on)\s+(\d{1,3})\b/g, to: 'set $1 to $2' },
  { from: /\bkeep\s+(?:the\s+)?(volume|sound|audio|brightness)\s+(?:at|to|on)\s+(\d{1,3})\b/g, to: 'set $1 to $2' },
  { from: /\b(volume|sound|audio|brightness)\s+(?:at|on)\s+(\d{1,3})\b/g, to: 'set $1 to $2' },
  { from: /\b(?:put|switch|turn)\s+(?:the\s+)?(?:net|internet|wifi|wi fi)\s+off\b/g, to: 'turn off wifi' },
  { from: /\b(?:put|switch|turn)\s+off\s+(?:the\s+)?(?:net|internet|wifi|wi fi)\b/g, to: 'turn off wifi' },
  { from: /\b(?:put|switch|turn)\s+(?:the\s+)?(?:net|internet|wifi|wi fi)\s+on\b/g, to: 'turn on wifi' },
  { from: /\b(?:put|switch|turn)\s+on\s+(?:the\s+)?(?:net|internet|wifi|wi fi)\b/g, to: 'turn on wifi' },
  { from: /\bput on\b/g, to: 'play' },
  { from: /\bstart playing\b/g, to: 'play' },
  { from: /\bplay me\b/g, to: 'play' },
  { from: /\bqueue up\b/g, to: 'play' },
  { from: /\bdo not do it\b/g, to: 'cancel' },
  { from: /\bdont do it\b/g, to: 'cancel' },
  { from: /\bforget it\b/g, to: 'cancel' },
  { from: /\bleave it\b/g, to: 'cancel' },
  { from: /\bnever mind\b/g, to: 'cancel' },
  { from: /\bfull screen\b/g, to: 'fullscreen' },
  { from: /\bminimise\b/g, to: 'minimize' },
  { from: /\bmaximise\b/g, to: 'maximize' },
  { from: /\bun\s+mute\b/g, to: 'unmute' },
  { from: /\bste\s+it\s+tom\s+(\d{1,3})\b/g, to: 'set volume to $1' },
  { from: /\bset\s+it\s+tom\s+(\d{1,3})\b/g, to: 'set volume to $1' },
  { from: /\bset\s+it\s+to\s+(\d{1,3})\b/g, to: 'set volume to $1' },
  { from: /\bunpause\b/g, to: 'resume' },
  { from: /\bcarry on\b/g, to: 'resume' },
  { from: /\bnexr\b/g, to: 'next' },
  { from: /\bsony\b/g, to: 'song' },
  { from: /\bweb site\b/g, to: 'website' },
  { from: /\bapplemusic\b/g, to: 'apple music' },
  { from: /\btime\s*-\s*table\b/g, to: 'time table' },
  { from: /\bdaily\s*time\s*table\b/g, to: 'daily timetable' },
  { from: /\bscreen shot\b/g, to: 'screenshot' },
  { from: /\btake picture of screen\b/g, to: 'take screenshot' },
  { from: /\bcapture the screen\b/g, to: 'capture screen' }
];

const TOKEN_CORRECTIONS = {
  activte: 'activate',
  alram: 'alarm',
  alaram: 'alarm',
  apllication: 'application',
  applcation: 'application',
  brighness: 'brightness',
  capatin: 'captain',
  caption: 'captain',
  captin: 'captain',
  capitol: 'capital',
  calender: 'calendar',
  calandr: 'calendar',
  calander: 'calendar',
  calenders: 'calendars',
  clander: 'calendar',
  clandar: 'calendar',
  cancle: 'cancel',
  canle: 'cancel',
  cancl: 'cancel',
  chenni: 'chennai',
  cloe: 'close',
  clos: 'close',
  clouse: 'close',
  cloth: 'close',
  clothes: 'close',
  cloze: 'close',
  clsoe: 'close',
  clint: 'client',
  cloudfare: 'cloudflare',
  cloudfair: 'cloudflare',
  crome: 'chrome',
  crom: 'chrome',
  cheom: 'chrome',
  chromem: 'chrome',
  chromme: 'chrome',
  decrese: 'decrease',
  developement: 'development',
  deveopemt: 'development',
  devlopement: 'development',
  devlopemt: 'development',
  develpment: 'development',
  discordd: 'discord',
  documants: 'documents',
  dont: 'do not',
  dowloads: 'downloads',
  downlodes: 'downloads',
  downolades: 'downloads',
  downolads: 'downloads',
  exitt: 'exit',
  firefix: 'firefox',
  foldr: 'folder',
  floder: 'folder',
  foler: 'folder',
  follder: 'folder',
  direcotry: 'directory',
  diretory: 'directory',
  dirctory: 'directory',
  githubb: 'github',
  increse: 'increase',
  minit: 'minute',
  minits: 'minutes',
  minuts: 'minutes',
  collge: 'college',
  collage: 'college',
  excercise: 'exercise',
  lauch: 'launch',
  lnauch: 'launch',
  mesage: 'message',
  musc: 'music',
  musci: 'music',
  mozila: 'mozilla',
  notpad: 'notepad',
  opne: 'open',
  noopen: 'open',
  internate: 'internet',
  internt: 'internet',
  playbak: 'playback',
  quik: 'quick',
  remeinder: 'reminder',
  remider: 'reminder',
  remionder: 'reminder',
  remionders: 'reminders',
  rose: 'close',
  seach: 'search',
  serch: 'search',
  searh: 'search',
  saerch: 'search',
  serach: 'search',
  screencap: 'screenshot',
  screenshort: 'screenshot',
  screenshorts: 'screenshots',
  screeshot: 'screenshot',
  screnshot: 'screenshot',
  scrnshot: 'screenshot',
  si: 'is',
  senttence: 'sentence',
  shiuld: 'should',
  photes: 'photos',
  photesw: 'photos',
  phots: 'photos',
  spoitfy: 'spotify',
  applemusic: 'apple music',
  ste: 'set',
  swtich: 'switch',
  tabes: 'tabs',
  taqb: 'tab',
  taqbs: 'tabs',
  teh: 'the',
  teems: 'teams',
  telgram: 'telegram',
  teligram: 'telegram',
  teigam: 'telegram',
  timr: 'timer',
  timtable: 'timetable',
  timetabel: 'timetable',
  timetablee: 'timetable',
  tommrow: 'tomorrow',
  tommorow: 'tomorrow',
  tomcures: 'tom cruise',
  tomcruise: 'tom cruise',
  anme: 'name',
  volum: 'volume',
  vol: 'volume',
  wifii: 'wifi',
  wify: 'wifi',
  worrd: 'word',
  workd: 'word',
  wordd: 'word',
  whatsap: 'whatsapp',
  whare: 'where',
  whre: 'where',
  youtub: 'youtube',
  yotube: 'youtube',
  yotub: 'youtube',
  chrmoe: 'chrome',
  chmo: 'chrome',
  chrm: 'chrome',
  chrom: 'chrome'
};

const TOKEN_SEQUENCE_REPLACEMENTS = [
  { from: ['whare', 'i'], to: ['where', 'is'] },
  { from: ['where', 'i'], to: ['where', 'is'] },
  { from: ['whre', 'i'], to: ['where', 'is'] },
  { from: ['what', 'sap'], to: ['whatsapp'] },
  { from: ['what', 'sapp'], to: ['whatsapp'] },
  { from: ['you', 'tube'], to: ['youtube'] },
  { from: ['micro', 'soft'], to: ['microsoft'] }
];

const DOMAIN_VOCABULARY = [
  'alarm',
  'application',
  'app',
  'battery',
  'brightness',
  'browser',
  'bring',
  'calendar',
  'captain',
  'chrome',
  'screenshots',
  'quick',
  'clock',
  'close',
  'copy',
  'cpu',
  'create',
  'delete',
  'desktop',
  'developer',
  'directory',
  'disk',
  'day',
  'date',
  'documents',
  'downloads',
  'edge',
  'erase',
  'excel',
  'file',
  'find',
  'folder',
  'google',
  'github',
  'help',
  'hour',
  'hours',
  'chatgpt',
  'gpt',
  'claude',
  'gemini',
  'perplexity',
  'javascript',
  'js',
  'launch',
  'link',
  'links',
  'lunch',
  'lock',
  'memory',
  'minute',
  'minutes',
  'minimize',
  'move',
  'music',
  'mute',
  'net',
  'navigate',
  'news',
  'node',
  'nodejs',
  'npm',
  'notepad',
  'open',
  'outlook',
  'paint',
  'pdf',
  'pdfs',
  'pictures',
  'processes',
  'ram',
  'remind',
  'reminder',
  'recurring',
  'remove',
  'rename',
  'restart',
  'result',
  'results',
  'run',
  'research',
  'search',
  'second',
  'seconds',
  'screenshot',
  'capture',
  'take',
  'score',
  'schedule',
  'match',
  'matches',
  'fifa',
  'world',
  'cup',
  'release',
  'released',
  'premiere',
  'price',
  'iphone',
  'dune',
  'movie',
  'movies',
  'best',
  'tom',
  'cruise',
  'settings',
  'shutdown',
  'sleep',
  'spotify',
  'status',
  'switch',
  'tab',
  'tabs',
  'team',
  'teams',
  'typescript',
  'winner',
  'winners',
  'champion',
  'champions',
  'capital',
  'cricket',
  'india',
  'indian',
  'ipl',
  'chennai',
  'gujarat',
  'suv',
  'name',
  'called',
  'meaning',
  'following',
  'sentence',
  'should',
  'node',
  'js',
  'javascript',
  'react',
  'angular',
  'tutorial',
  'tutorials',
  'weather',
  'internet',
  'wifi',
  'mumbai',
  'latest',
  'ai',
  'laptop',
  'under',
  'difference',
  'between',
  'japan',
  'tokyo',
  'duplicate',
  'duplicates',
  'downloaded',
  'week',
  'newest',
  'timer',
  'time',
  'countdown',
  'pomodoro',
  'study',
  'focus',
  'break',
  'session',
  'pause',
  'resume',
  'reset',
  'snooze',
  'weekday',
  'unmute',
  'url',
  'videos',
  'volume',
  'website',
  'site',
  'webapp',
  'online',
  'internet',
  'window',
  'word',
  'youtube',
  'zoom',
  'queue',
  'play',
  'song',
  'songs',
  'music',
  'track',
  'tracks',
  'media',
  'playback',
  'next',
  'previous',
  'prev',
  'pause',
  'resume',
  'skip',
  'continue',
  'unpause',
  'fullscreen',
  'full',
  'screen',
  'watch'
];

return {
  DOMAIN_VOCABULARY,
  FILLER_WORDS,
  LEAD_IN_PATTERNS,
  PHRASE_REPLACEMENTS,
  TOKEN_CORRECTIONS,
  TOKEN_SEQUENCE_REPLACEMENTS
};

})();

function applyPhraseReplacements(text) {
  let result = String(text || '');
  for (const replacement of PHRASE_REPLACEMENTS) {
    result = result.replace(replacement.from, replacement.to);
  }
  return result;
}

function stripLeadIns(text) {
  let result = String(text || '').trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of LEAD_IN_PATTERNS) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function collapseRepeatedTokens(tokens) {
  const collapsed = [];
  for (const token of tokens) {
    if (!token) continue;
    if (collapsed[collapsed.length - 1] === token) continue;
    collapsed.push(token);
  }
  return collapsed;
}

function applyTokenSequenceReplacements(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const result = [];

  for (let index = 0; index < tokens.length; index += 1) {
    let matched = false;

    for (const replacement of TOKEN_SEQUENCE_REPLACEMENTS) {
      const source = replacement.from || [];
      if (source.length === 0 || index + source.length > tokens.length) {
        continue;
      }

      const isMatch = source.every((token, offset) => tokens[index + offset] === token);
      if (!isMatch) {
        continue;
      }

      result.push(...replacement.to);
      index += source.length - 1;
      matched = true;
      break;
    }

    if (!matched) {
      result.push(tokens[index]);
    }
  }

  return result;
}

function buildBigrams(tokens) {
  const result = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    result.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return result;
}

function preprocessCommand(text) {
  const expanded = Normalizer.expandContractions(text || '');
  const spaced = expanded
    .replace(/\b([a-zA-Z]{2,})(\d{2,4})\b/g, '$1 $2')
    .replace(/\b(\d{2,4})([a-zA-Z]{2,})\b/g, '$1 $2');
  const normalized = Normalizer.normalizeText(spaced);
  const stripped = stripLeadIns(normalized);
  const replaced = applyPhraseReplacements(stripped);
  const sequenceRepaired = applyTokenSequenceReplacements(Normalizer.tokenize(replaced));
  const tokens = collapseRepeatedTokens(sequenceRepaired);

  return {
    normalizedText: tokens.join(' ').trim(),
    tokens
  };
}

module.exports = {
  DOMAIN_VOCABULARY,
  FILLER_WORDS,
  LEAD_IN_PATTERNS,
  PHRASE_REPLACEMENTS,
  TOKEN_CORRECTIONS,
  TOKEN_SEQUENCE_REPLACEMENTS,
  applyPhraseReplacements,
  applyTokenSequenceReplacements,
  buildBigrams,
  collapseRepeatedTokens,
  preprocessCommand,
  stripLeadIns
};
