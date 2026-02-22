/**
 * Memory Extractor Service - Enhanced Edition
 *
 * Extracts memories with improved classification:
 * - Static memories: Facts with person's NAME (e.g., "Sarah Johnson is 28 years old")
 * - Dynamic memories: Facts starting with "User" (e.g., "User prefers dark mode")
 * - Memory kinds: fact, preference, event
 * - Temporal awareness with expiry detection
 * - Entity extraction
 * - Multi-speaker handling
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================================
// TYPES
// ============================================================================

export type MemoryKind = 'fact' | 'preference' | 'event';

export interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'location' | 'date' | 'other';
}

export interface ExtractedMemory {
  content: string;
  isStatic: boolean;  // true = named entity fact, false = "User" prefixed fact
  confidence: number;
  kind: MemoryKind;
  expiresAt?: number;  // Unix timestamp for time-sensitive facts
  entities?: string[];  // Extracted entity names
  speaker?: string;  // For multi-speaker content attribution
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
  title: string;
  summary: string;
  entities: ExtractedEntity[];
  rawEntities: string[];  // Backward compat - just entity names
}

// ============================================================================
// CONSTANTS
// ============================================================================

// NO LIMITS - extract everything
const MAX_CONTENT_LENGTH = Infinity;
const MIN_CONTENT_LENGTH = 1;
const MIN_MEMORY_LENGTH = 1;
const MAX_MEMORY_LENGTH = Infinity;
const MIN_CONFIDENCE_THRESHOLD = 0.1;
const MAX_MEMORIES_PER_EXTRACTION = Infinity;

// Temporal patterns for detecting time-sensitive content
const TEMPORAL_PATTERNS = {
  // Relative time expressions
  tomorrow: { regex: /\b(?:tomorrow|tmrw)\b/i, daysFromNow: 1 },
  today: { regex: /\btoday\b/i, daysFromNow: 0 },
  nextWeek: { regex: /\bnext\s+week\b/i, daysFromNow: 7 },
  nextMonth: { regex: /\bnext\s+month\b/i, daysFromNow: 30 },
  thisWeekend: { regex: /\bthis\s+weekend\b/i, daysFromNow: calculateDaysToWeekend() },
  inXDays: { regex: /\bin\s+(\d+)\s+days?\b/i, dynamic: true },
  inXWeeks: { regex: /\bin\s+(\d+)\s+weeks?\b/i, dynamic: true, multiplier: 7 },
  inXMonths: { regex: /\bin\s+(\d+)\s+months?\b/i, dynamic: true, multiplier: 30 },
};

// Event keywords that suggest time-sensitive content
const EVENT_KEYWORDS = [
  'meeting', 'appointment', 'deadline', 'exam', 'interview', 'flight',
  'reservation', 'booking', 'event', 'conference', 'call', 'presentation',
  'due', 'expires', 'birthday', 'anniversary', 'schedule'
];

// Day names for relative date calculations
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
                     'july', 'august', 'september', 'october', 'november', 'december'];

// Multi-speaker patterns
const SPEAKER_PATTERNS = [
  /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:\s*/,  // "John:" or "John Smith:"
  /^\[([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\]\s*/,  // "[John]" or "[John Smith]"
  /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+said\s*:\s*/i,  // "John said:"
];

// ============================================================================
// PRONOUN/COREFERENCE RESOLUTION
// ============================================================================

// Common female first names for gender detection
const FEMALE_NAMES = new Set([
  'emily', 'emma', 'olivia', 'ava', 'sophia', 'isabella', 'mia', 'charlotte',
  'amelia', 'harper', 'evelyn', 'abigail', 'elizabeth', 'sofia', 'ella', 'grace',
  'chloe', 'victoria', 'lily', 'hannah', 'natalie', 'zoe', 'leah', 'hazel',
  'aurora', 'savannah', 'audrey', 'brooklyn', 'bella', 'claire', 'skylar',
  'lucy', 'anna', 'caroline', 'genesis', 'aaliyah', 'kennedy', 'allison',
  'maya', 'sarah', 'madelyn', 'adeline', 'alexa', 'ariana', 'elena', 'gabriella',
  'naomi', 'alice', 'sadie', 'hailey', 'eva', 'emilia', 'autumn', 'quinn',
  'nevaeh', 'piper', 'ruby', 'serenity', 'willow', 'everly', 'cora', 'kaylee',
  'lydia', 'aubrey', 'arianna', 'eliana', 'peyton', 'melanie', 'gianna', 'isabelle',
  'julia', 'valentina', 'nova', 'clara', 'vivian', 'reagan', 'mackenzie',
  'maria', 'mary', 'patricia', 'jennifer', 'linda', 'susan', 'jessica', 'karen',
  'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'dorothy', 'kimberly',
  'helen', 'samantha', 'katherine', 'christine', 'deborah', 'rachel', 'laura',
  'carolyn', 'janet', 'catherine', 'frances', 'ann', 'joyce', 'diane',
  // Additional common names and nicknames for pronoun resolution
  'amy', 'kate', 'katie', 'beth', 'liz', 'lizzie', 'meg', 'maggie', 'sue', 'suzy',
  'anne', 'annie', 'jenny', 'jess', 'jessie', 'kim', 'kris', 'kristy', 'mandy',
  'molly', 'penny', 'sally', 'sandy', 'tina', 'vicky', 'wendy', 'jo', 'joan',
  'jane', 'jean', 'jill', 'rose', 'marie', 'lisa', 'lori', 'tiffany', 'amber'
]);

// Common male first names for gender detection
const MALE_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'raymond', 'samuel', 'benjamin', 'gregory', 'frank', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'henry',
  'nathan', 'douglas', 'zachary', 'peter', 'kyle', 'noah', 'ethan', 'jeremy',
  'walter', 'christian', 'keith', 'roger', 'terry', 'austin', 'sean', 'gerald',
  'carl', 'dylan', 'harold', 'jordan', 'jesse', 'bryan', 'lawrence', 'arthur',
  'gabriel', 'bruce', 'logan', 'albert', 'willie', 'alan', 'eugene', 'russell',
  'vincent', 'philip', 'bobby', 'johnny', 'bradley', 'liam', 'mason', 'oliver',
  'lucas', 'aiden', 'elijah', 'sebastian', 'mateo', 'owen', 'theodore', 'levi',
  // Additional common names and nicknames for pronoun resolution
  'tom', 'tommy', 'bob', 'bobby', 'bill', 'billy', 'mike', 'jim', 'jimmy', 'joe',
  'alex', 'ben', 'dan', 'dave', 'ed', 'eddie', 'fred', 'greg', 'harry', 'ian',
  'jake', 'jeff', 'ken', 'leo', 'max', 'nick', 'pat', 'pete', 'phil', 'ray',
  'rob', 'ron', 'sam', 'steve', 'ted', 'tim', 'tony', 'vic', 'will', 'zach'
]);

/**
 * Detect gender from a name based on common first name lists
 * Returns 'female', 'male', or 'unknown'
 */
function detectGender(name: string): 'female' | 'male' | 'unknown' {
  if (!name) return 'unknown';

  const parts = name.split(/\s+/);
  let firstName = parts[0].toLowerCase().replace(/[^a-z]/g, '');

  // If first part is a title (Dr., Mr., Mrs., etc.), use second part
  if (['dr', 'mr', 'mrs', 'ms', 'miss', 'prof'].includes(firstName) && parts.length > 1) {
    firstName = parts[1].toLowerCase().replace(/[^a-z]/g, '');
  }

  // Check title-based gender hints first
  const firstWord = parts[0].toLowerCase().replace(/\./g, '');
  if (firstWord === 'mrs' || firstWord === 'ms' || firstWord === 'miss') {
    return 'female';
  }
  if (firstWord === 'mr') {
    return 'male';
  }

  if (FEMALE_NAMES.has(firstName)) return 'female';
  if (MALE_NAMES.has(firstName)) return 'male';

  return 'unknown';
}

/**
 * Extract named entities from text with their positions
 */
function extractNamedEntitiesWithPositions(text: string): Array<{name: string, position: number, gender: 'female' | 'male' | 'unknown'}> {
  const entities: Array<{name: string, position: number, gender: 'female' | 'male' | 'unknown'}> = [];
  const seen = new Set<string>();

  // Match titles + names first
  const titleNamePattern = /(?:Dr\.|Mr\.|Mrs\.|Ms\.|Miss|Prof\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  let match;
  while ((match = titleNamePattern.exec(text)) !== null) {
    const fullMatch = match[0].trim();
    const lowerName = fullMatch.toLowerCase();
    if (!seen.has(lowerName)) {
      seen.add(lowerName);
      entities.push({ name: fullMatch, position: match.index, gender: detectGender(fullMatch) });
    }
  }

  // Match two+ capitalized words (likely names)
  const multiWordNamePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  while ((match = multiWordNamePattern.exec(text)) !== null) {
    const name = match[1].trim();
    const lowerName = name.toLowerCase();
    if (!seen.has(lowerName) && !isCommonWord(name.split(' ')[0])) {
      seen.add(lowerName);
      entities.push({ name, position: match.index, gender: detectGender(name) });
    }
  }

  // Also look for single capitalized names that are in our name lists
  const simpleNamePattern = /\b([A-Z][a-z]{2,})\b/g;
  while ((match = simpleNamePattern.exec(text)) !== null) {
    const name = match[1];
    const lowerName = name.toLowerCase();
    if (!seen.has(lowerName) && (FEMALE_NAMES.has(lowerName) || MALE_NAMES.has(lowerName))) {
      seen.add(lowerName);
      entities.push({ name, position: match.index, gender: detectGender(name) });
    }
  }

  return entities.sort((a, b) => a.position - b.position);
}

/**
 * Resolve pronouns in text to their antecedents (coreference resolution)
 *
 * CRITICAL for memory extraction - converts:
 *   "Dr. Emily Chen leads the team. She published 3 papers."
 * to:
 *   "Dr. Emily Chen leads the team. Emily Chen published 3 papers."
 */
function resolvePronouns(text: string): string {
  if (!text || typeof text !== 'string') return text;

  const entities = extractNamedEntitiesWithPositions(text);
  if (entities.length === 0) return text;

  console.log(`   🔗 Pronoun resolution: found ${entities.length} entities:`, entities.map(e => `${e.name}(${e.gender})`));

  let lastFemale: string | null = null;
  let lastMale: string | null = null;
  let lastEntity: string | null = null;

  // Split by sentence endings, but NOT after common titles (Dr., Mr., Mrs., Ms., Prof., Jr., Sr., etc.)
  // Use a manual splitting approach for better control over title handling
  const splitIntoSentences = (inputText: string): string[] => {
    // First, protect title abbreviations by replacing their periods with a placeholder
    const titlePattern = /\b(Dr|Mr|Mrs|Ms|Miss|Prof|Jr|Sr|Inc|Ltd|Corp|vs|etc|e\.g|i\.e)\./gi;
    let protected_ = inputText.replace(titlePattern, '$1\u0000'); // Use null char as placeholder

    // Now split on actual sentence endings
    const parts = protected_.split(/(?<=[.!?])\s+/);

    // Restore the periods in titles
    return parts.map(p => p.replace(/\u0000/g, '.'));
  };

  const sentences = splitIntoSentences(text);
  console.log(`   🔗 Split into ${sentences.length} sentences for pronoun tracking`);
  const resolvedSentences: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    // Update entity tracking
    for (const entity of entities) {
      // Calculate clean name (without title) for matching and replacement
      const nameParts = entity.name.split(/\s+/);
      const cleanName = nameParts[0].match(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?$/i)
        ? nameParts.slice(1).join(' ')
        : entity.name;

      // Match either the full entity name or the clean name (without title)
      if (sentence.includes(entity.name) || (cleanName !== entity.name && sentence.includes(cleanName))) {
        lastEntity = cleanName || entity.name;

        if (entity.gender === 'female') {
          lastFemale = cleanName || entity.name;
          console.log(`   🔗 Sentence ${i + 1}: Found female entity "${entity.name}" -> tracking as "${lastFemale}"`);
        } else if (entity.gender === 'male') {
          lastMale = cleanName || entity.name;
          console.log(`   🔗 Sentence ${i + 1}: Found male entity "${entity.name}" -> tracking as "${lastMale}"`);
        } else {
          console.log(`   🔗 Sentence ${i + 1}: Found entity "${entity.name}" with unknown gender`);
        }
      }
    }

    let resolved = sentence;

    // Replace female pronouns
    if (lastFemale) {
      resolved = resolved.replace(/\bShe\b/g, lastFemale);
      resolved = resolved.replace(/\bshe\b/g, lastFemale);
      resolved = resolved.replace(/\bHer\b(?!\s+(?:own|self))/g, lastFemale + "'s");
      resolved = resolved.replace(/\bher\b(?!\s+(?:own|self))/g, lastFemale + "'s");
      resolved = resolved.replace(/\bHers\b/g, lastFemale + "'s");
      resolved = resolved.replace(/\bhers\b/g, lastFemale + "'s");
      resolved = resolved.replace(/\bHerself\b/g, lastFemale);
      resolved = resolved.replace(/\bherself\b/g, lastFemale);
    }

    // Replace male pronouns
    if (lastMale) {
      resolved = resolved.replace(/\bHe\b/g, lastMale);
      resolved = resolved.replace(/\bhe\b/g, lastMale);
      resolved = resolved.replace(/\bHis\b/g, lastMale + "'s");
      resolved = resolved.replace(/\bhis\b/g, lastMale + "'s");
      resolved = resolved.replace(/\bHim\b/g, lastMale);
      resolved = resolved.replace(/\bhim\b/g, lastMale);
      resolved = resolved.replace(/\bHimself\b/g, lastMale);
      resolved = resolved.replace(/\bhimself\b/g, lastMale);
    }

    // Replace singular they when clearly singular
    if (lastEntity) {
      const singularTheyPatterns = [
        /\bThey\s+(is|has|was|does|wants|needs|likes|prefers|published|wrote|said|thinks|believes|works|leads|manages)\b/g,
        /\bthey\s+(is|has|was|does|wants|needs|likes|prefers|published|wrote|said|thinks|believes|works|leads|manages)\b/g,
      ];
      for (const pattern of singularTheyPatterns) {
        resolved = resolved.replace(pattern, (_, verb) => lastEntity + ' ' + verb);
      }
      resolved = resolved.replace(/\bTheir\s+(paper|work|research|team|company|project|contribution)\b/g, (_, noun) => lastEntity + "'s " + noun);
      resolved = resolved.replace(/\btheir\s+(paper|work|research|team|company|project|contribution)\b/g, (_, noun) => lastEntity + "'s " + noun);
    }

    resolvedSentences.push(resolved);
  }

  const result = resolvedSentences.join(' ');
  if (result !== text) {
    console.log(`   🔗 Pronoun resolution applied:`);
    console.log(`      Before: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    console.log(`      After:  ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
  }
  return result;
}

// ============================================================================
// PERMANENT vs TEMPORARY FACT PATTERNS (for static/dynamic classification)
// ============================================================================

/**
 * Patterns that indicate PERMANENT biographical facts
 * These should ALWAYS be classified as static, even if they start with "User"
 *
 * Examples:
 * - "User's name is Alex Johnson" → STATIC (permanent identity)
 * - "User was born on March 15, 1990" → STATIC (permanent fact)
 * - "User graduated from MIT" → STATIC (permanent achievement)
 * - "User is currently working on Q4 roadmap" → DYNAMIC (temporary state)
 */
const PERMANENT_FACT_PATTERNS: RegExp[] = [
  // NAME patterns - permanent identity
  /\bname\s+is\b/i,                           // "name is Alex"
  /\bis\s+named?\b/i,                         // "is named Alex" / "is name Alex"
  /\bcalled\s+[A-Z]/i,                        // "called Alex"
  /\bknown\s+as\b/i,                          // "known as Alex"
  /\bgoes\s+by\b/i,                           // "goes by Alex"

  // BIRTH/AGE patterns - permanent facts
  /\bborn\s+(?:on|in)\b/i,                    // "born on March 15" / "born in 1990"
  /\bbirthday\s+(?:is|on)\b/i,                // "birthday is March 15"
  /\bbirthdate\b/i,                           // "birthdate"
  /\bdate\s+of\s+birth\b/i,                   // "date of birth"
  /\bbirth\s+date\b/i,                        // "birth date"
  /\b\d+\s+years?\s+old\b/i,                  // "28 years old" (permanent at time of statement)
  /\bage\s+(?:is\s+)?\d+\b/i,                 // "age is 28" / "age 28"

  // EDUCATION patterns - permanent achievements
  /\bgraduated?\s+(?:from|at|in)\b/i,         // "graduated from MIT"
  /\bdegree\s+(?:in|from)\b/i,                // "degree in CS"
  /\b(?:bachelor|master|phd|doctorate|mba)\b/i, // degree types
  /\bstudied\s+(?:at|in)\b/i,                 // "studied at MIT"
  /\buniversity\b/i,                          // "university"
  /\bcollege\b/i,                             // "college"
  /\balma\s+mater\b/i,                        // "alma mater"
  /\bmajored?\s+in\b/i,                       // "majored in CS"

  // PERMANENT LOCATION patterns (origin, not current)
  /\bborn\s+in\b/i,                           // "born in Seattle"
  /\bgrew\s+up\s+in\b/i,                      // "grew up in Seattle"
  /\bnative\s+(?:of|to)\b/i,                  // "native of Seattle"
  /\bhometown\b/i,                            // "hometown"
  /\boriginally\s+from\b/i,                   // "originally from Seattle"

  // FAMILY RELATIONSHIPS - permanent
  /\b(?:wife|husband|spouse|partner)\s+is\b/i,  // "wife is Sarah"
  /\b(?:mother|father|mom|dad)\s+is\b/i,        // "mother is Mary"
  /\b(?:son|daughter|child)\s+is\b/i,           // "son is John"
  /\b(?:brother|sister|sibling)\s+is\b/i,       // "brother is Mike"
  /\bmarried\s+to\b/i,                          // "married to Sarah"
  /\b(?:boyfriend|girlfriend)\s+is\b/i,         // relationships

  // ETHNICITY/NATIONALITY - permanent
  /\bnationality\b/i,                         // "nationality is American"
  /\bcitizen(?:ship)?\b/i,                    // "citizen of US"
  /\bethnicity\b/i,                           // "ethnicity"
  /\bheritage\b/i,                            // "heritage"

  // PROFESSION/JOB patterns - relatively stable
  /\bis\s+a[n]?\s+(?:software|senior|lead|principal|staff|junior|associate|chief|head|director)/i,  // "is a software engineer"
  /\bis\s+a[n]?\s+(?:engineer|developer|doctor|lawyer|architect|designer|manager|analyst|scientist)/i,
  /\bworks?\s+as\s+a[n]?\b/i,                  // "works as a developer"
  /\bworks?\s+at\b/i,                          // "works at Google"
  /\bemployed\s+(?:at|by)\b/i,                 // "employed at Microsoft"
  /\b(?:CEO|CTO|CFO|COO|VP|director|manager)\s+(?:of|at)\b/i,  // titles

  // LOCATION/RESIDENCE patterns - relatively stable
  /\blives?\s+in\b/i,                          // "lives in Seattle"
  /\bbased\s+in\b/i,                           // "based in San Francisco"
  /\bresides?\s+in\b/i,                        // "resides in NYC"
  /\blocated\s+in\b/i,                         // "located in Austin"

  // SKILLS/EXPERTISE patterns - relatively stable
  /\bspecializes?\s+in\b/i,                    // "specializes in AI"
  /\bexpert\s+in\b/i,                          // "expert in machine learning"
  /\bexpertise\s+in\b/i,                       // "expertise in backend"
  /\bproficient\s+in\b/i,                      // "proficient in Python"
  /\bskilled\s+in\b/i,                         // "skilled in React"

  // HOBBIES/INTERESTS - relatively stable traits
  /\benjoys?\s+(?:playing|doing|watching|reading|cooking|traveling|hiking|swimming|running)/i,
  /\bloves?\s+(?:playing|doing|watching|reading|cooking|traveling|hiking|swimming|running)/i,
  /\bpassionate\s+about\b/i,                   // "passionate about music"
  /\bhobby\s+is\b/i,                           // "hobby is photography"
  /\binterested\s+in\b/i,                      // "interested in AI"

  // PET patterns - stable
  /\bhas\s+a\s+(?:cat|dog|pet|bird|fish)\b/i,  // "has a cat"
  /\b(?:cat|dog|pet)\s+(?:is\s+)?named\b/i,    // "cat named Luna"
  /\bowns?\s+a\s+(?:cat|dog|pet)\b/i,          // "owns a dog"
];

/**
 * Patterns that indicate TEMPORARY/CHANGING facts
 * These should be classified as dynamic even if they match permanent patterns
 */
const TEMPORARY_FACT_PATTERNS: RegExp[] = [
  /\bcurrently\b/i,                           // "currently working on"
  /\bright\s+now\b/i,                         // "right now"
  /\bat\s+the\s+moment\b/i,                   // "at the moment"
  /\bworking\s+on\b/i,                        // "working on [project]"
  /\bthis\s+(?:week|month|quarter|year)\b/i,  // "this quarter"
  /\btoday\b/i,                               // "today"
  /\brecently\b/i,                            // "recently started"
  /\bplanning\s+to\b/i,                       // "planning to"
  /\bgoing\s+to\b/i,                          // "going to"
  /\bwill\s+be\b/i,                           // "will be"
  /\btemporarily\b/i,                         // "temporarily"
  // Present-progressive verbs indicate TEMPORARY state
  /\bis\s+(?:reading|working|watching|learning|studying|doing|making|building|writing|planning|preparing)\b/i,
  /\bcurrently\s+(?:reading|working|watching|learning|studying|doing|making|building|writing|planning)\b/i,
];

// ============================================================================
// LAZY INITIALIZATION
// ============================================================================

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate days until next weekend (Saturday)
 */
function calculateDaysToWeekend(): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
  return daysUntilSaturday === 0 ? 7 : daysUntilSaturday;
}

/**
 * Format a date as "YYYY-MM-DD at HH:MM UTC"
 */
function formatDateWithTime(date: Date, includeTime: boolean = false, timeStr?: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  if (includeTime && timeStr) {
    // Convert time like "3pm", "3:30pm", "15:00" to 24-hour format
    const time24 = convertTo24Hour(timeStr);
    return `${dateStr} at ${time24} UTC`;
  }

  return dateStr;
}

/**
 * Convert time string to 24-hour format
 * "3pm" -> "15:00", "3:30pm" -> "15:30", "15:00" -> "15:00"
 */
function convertTo24Hour(timeStr: string): string {
  const cleanTime = timeStr.toLowerCase().trim();

  // Already in 24-hour format
  if (/^\d{1,2}:\d{2}$/.test(cleanTime)) {
    const [hours, mins] = cleanTime.split(':');
    return `${hours.padStart(2, '0')}:${mins}`;
  }

  // Parse 12-hour format: "3pm", "3:30pm", "3 pm", "3:30 pm"
  const match = cleanTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const mins = match[2] || '00';
    const period = match[3].toLowerCase();

    if (period === 'pm' && hours !== 12) {
      hours += 12;
    } else if (period === 'am' && hours === 12) {
      hours = 0;
    }

    return `${String(hours).padStart(2, '0')}:${mins}`;
  }

  // Just hours: "3" (assume PM for common times)
  if (/^\d{1,2}$/.test(cleanTime)) {
    const hours = parseInt(cleanTime, 10);
    // Assume PM for hours 1-11, keep as-is for 12+
    const adjustedHours = hours < 12 ? hours + 12 : hours;
    return `${String(adjustedHours).padStart(2, '0')}:00`;
  }

  return cleanTime;
}

/**
 * Get the next occurrence of a weekday from a reference date
 */
function getNextWeekday(referenceDate: Date, targetDay: number): Date {
  // "next Monday/Friday" means NEXT WEEK's day, not just the upcoming occurrence
  // So we always go to the next week's target day
  const result = new Date(referenceDate);
  const currentDay = result.getDay();
  let daysToAdd = targetDay - currentDay;

  // Always go to NEXT week for "next X" pattern
  // If target day is after today this week, still go to next week
  if (daysToAdd <= 0) {
    daysToAdd += 7;
  } else {
    // Target is later this week, but "next X" means next week
    daysToAdd += 7;
  }

  result.setDate(result.getDate() + daysToAdd);
  return result;
}

/**
 * Extract a context date from text (e.g., from session headers or explicit timestamps)
 * Returns the LATEST date found in the text, or null if none found
 *
 * Patterns recognized:
 * - [Session X - 1:56 pm on 8 May, 2023]
 * - "on January 15, 2023"
 * - "8 May 2023"
 * - "2023-05-08"
 */
function extractContextDate(text: string): Date | null {
  const patterns = [
    // [Session X - TIME on DAY MONTH, YEAR] or [Session X - TIME on DAY MONTH YEAR]
    /\[Session\s+\d+\s*[-–]\s*[\d:]+\s*(?:am|pm)?\s*on\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(\d{4})\]/gi,
    // "on DAY MONTH, YEAR" or "on DAY MONTH YEAR"
    /on\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+(\d{4})/gi,
    // "MONTH DAY, YEAR"
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})[,\s]+(\d{4})/gi,
    // "DAY MONTH YEAR" (no comma)
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi,
    // ISO format YYYY-MM-DD
    /(\d{4})-(\d{2})-(\d{2})/g,
  ];

  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

  let latestDate: Date | null = null;

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      let date: Date | null = null;

      if (pattern.source.includes('Session')) {
        // [Session X - TIME on DAY MONTH, YEAR]
        const day = parseInt(match[1], 10);
        const month = monthMap[match[2].toLowerCase()];
        const year = parseInt(match[3], 10);
        date = new Date(year, month, day);
      } else if (pattern.source.startsWith('on')) {
        // "on DAY MONTH, YEAR"
        const day = parseInt(match[1], 10);
        const month = monthMap[match[2].toLowerCase()];
        const year = parseInt(match[3], 10);
        date = new Date(year, month, day);
      } else if (pattern.source.startsWith('\\(\\d{4}\\)')) {
        // ISO format
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        date = new Date(year, month, day);
      } else if (pattern.source.startsWith('\\(January')) {
        // "MONTH DAY, YEAR"
        const month = monthMap[match[1].toLowerCase()];
        const day = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        date = new Date(year, month, day);
      } else {
        // "DAY MONTH YEAR"
        const day = parseInt(match[1], 10);
        const month = monthMap[match[2].toLowerCase()];
        const year = parseInt(match[3], 10);
        date = new Date(year, month, day);
      }

      if (date && !isNaN(date.getTime())) {
        // Use UTC date to avoid timezone issues
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
        if (!latestDate || utcDate > latestDate) {
          latestDate = utcDate;
        }
      }
    }
  }

  if (latestDate) {
    console.log(`   📅 Extracted context date from text: ${latestDate.toISOString().split('T')[0]}`);
  }

  return latestDate;
}

/**
 * Convert ALL relative date expressions to absolute dates
 * This function processes text BEFORE LLM extraction to ensure consistent date handling
 *
 * @param text - The input text containing relative date expressions
 * @param referenceDate - The reference date (usually "now") for calculations
 * @returns Text with all relative dates converted to absolute dates
 */
function convertRelativeDates(text: string, referenceDate: Date): string {
  let result = text;
  const conversions: string[] = [];

  // Extract time if present (to preserve it)
  const extractTime = (str: string): string | undefined => {
    const timeMatch = str.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    return timeMatch ? timeMatch[1] : undefined;
  };

  // Helper to track conversions
  const trackConversion = (original: string, converted: string) => {
    conversions.push(`"${original}" -> "${converted}"`);
    return converted;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 1: "tomorrow" -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\b(tomorrow)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, _word, trailingSpace, time) => {
      const tomorrow = new Date(referenceDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const converted = formatDateWithTime(tomorrow, !!time, time);
      conversions.push(`"${match.trim()}" -> "${converted}"`);
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 2: "yesterday" -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\b(yesterday)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, _word, trailingSpace, time) => {
      const yesterday = new Date(referenceDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const converted = formatDateWithTime(yesterday, !!time, time);
      conversions.push(`"${match.trim()}" -> "${converted}"`);
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 3: "today" -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\b(today)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, _word, trailingSpace, time) => {
      const converted = formatDateWithTime(referenceDate, !!time, time);
      conversions.push(`"${match.trim()}" -> "${converted}"`);
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 4: "next Monday/Tuesday/..." -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, dayName, trailingSpace, time) => {
      const targetDayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
      if (targetDayIndex === -1) return match;

      const nextDay = getNextWeekday(referenceDate, targetDayIndex);
      const converted = formatDateWithTime(nextDay, !!time, time);
      conversions.push(`"${match.trim()}" -> "${converted}"`);
      // Preserve trailing space if it existed and no time was matched
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 5: "this Monday/Tuesday/..." -> actual date (current week)
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, dayName, time) => {
      const targetDayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
      if (targetDayIndex === -1) return match;

      const currentDay = referenceDate.getDay();
      const thisWeekDay = new Date(referenceDate);
      const diff = targetDayIndex - currentDay;
      thisWeekDay.setDate(thisWeekDay.getDate() + diff);

      return formatDateWithTime(thisWeekDay, !!time, time);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 5b: Standalone "Monday/Tuesday/..." (without next/this/last prefix)
  // Assumes the upcoming occurrence of that day
  // Example: "keynote is Tuesday at 9am" -> "keynote is 2026-02-24 at 09:00 UTC"
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\b(?<!next\s)(?<!this\s)(?<!last\s)(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, dayName, trailingSpace, time) => {
      const targetDayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
      if (targetDayIndex === -1) return match;

      const currentDay = referenceDate.getDay();
      let daysToAdd = targetDayIndex - currentDay;

      // If target day is today or has passed this week, go to next week
      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }

      const targetDate = new Date(referenceDate);
      targetDate.setDate(targetDate.getDate() + daysToAdd);

      const converted = formatDateWithTime(targetDate, !!time, time);
      conversions.push(`"${match.trim()}" -> "${converted}"`);
      // Preserve trailing space if it existed and no time was matched
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 6: "in X days/weeks/months/years" -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bin\s+(\d+)\s+(days?|weeks?|months?|years?)(\s*)(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/gi,
    (match, num, unit, trailingSpace, time) => {
      const count = parseInt(num, 10);
      const futureDate = new Date(referenceDate);

      const unitLower = unit.toLowerCase();
      if (unitLower.startsWith('day')) {
        futureDate.setDate(futureDate.getDate() + count);
      } else if (unitLower.startsWith('week')) {
        futureDate.setDate(futureDate.getDate() + count * 7);
      } else if (unitLower.startsWith('month')) {
        futureDate.setMonth(futureDate.getMonth() + count);
      } else if (unitLower.startsWith('year')) {
        futureDate.setFullYear(futureDate.getFullYear() + count);
      }

      const converted = formatDateWithTime(futureDate, !!time, time);
      return converted + (trailingSpace && !time ? trailingSpace : '');
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 7: "X days/weeks/months/years ago" -> actual date
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\b(\d+)\s+(days?|weeks?|months?|years?)\s+ago\b/gi,
    (match, num, unit) => {
      const count = parseInt(num, 10);
      const pastDate = new Date(referenceDate);

      const unitLower = unit.toLowerCase();
      if (unitLower.startsWith('day')) {
        pastDate.setDate(pastDate.getDate() - count);
      } else if (unitLower.startsWith('week')) {
        pastDate.setDate(pastDate.getDate() - count * 7);
      } else if (unitLower.startsWith('month')) {
        pastDate.setMonth(pastDate.getMonth() - count);
      } else if (unitLower.startsWith('year')) {
        pastDate.setFullYear(pastDate.getFullYear() - count);
      }

      return formatDateWithTime(pastDate, false);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 8: "next week" -> date range (start of next week)
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bnext\s+week\b/gi,
    () => {
      const nextWeek = new Date(referenceDate);
      const currentDay = nextWeek.getDay();
      // Calculate days until next Monday
      const daysUntilNextMonday = (8 - currentDay) % 7 || 7;
      nextWeek.setDate(nextWeek.getDate() + daysUntilNextMonday);

      const weekEnd = new Date(nextWeek);
      weekEnd.setDate(weekEnd.getDate() + 6);

      return `week of ${formatDateWithTime(nextWeek, false)}`;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 9: "this week" -> current week range
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bthis\s+week\b/gi,
    (match) => {
      const startOfWeek = new Date(referenceDate);
      const currentDay = startOfWeek.getDay();
      // Go back to Monday of this week
      startOfWeek.setDate(startOfWeek.getDate() - ((currentDay + 6) % 7));

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);

      const converted = `week of ${formatDateWithTime(startOfWeek, false)}`;
      conversions.push(`"${match}" -> "${converted}"`);
      return converted;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 10: "next month" -> month name and year
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bnext\s+month\b/gi,
    () => {
      const nextMonth = new Date(referenceDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const monthName = MONTH_NAMES[nextMonth.getMonth()];
      return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${nextMonth.getFullYear()}`;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 11: "this weekend" -> actual dates
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\bthis\s+weekend\b/gi,
    () => {
      const saturday = new Date(referenceDate);
      const currentDay = saturday.getDay();
      const daysUntilSat = (6 - currentDay + 7) % 7;
      saturday.setDate(saturday.getDate() + (daysUntilSat === 0 && currentDay !== 6 ? 7 : daysUntilSat));

      const sunday = new Date(saturday);
      sunday.setDate(sunday.getDate() + 1);

      return `${formatDateWithTime(saturday, false)} to ${formatDateWithTime(sunday, false)}`;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 12: "last Monday/Tuesday/..." -> actual date (previous occurrence)
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (match, dayName) => {
      const targetDayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
      if (targetDayIndex === -1) return match;

      const lastDay = new Date(referenceDate);
      const currentDay = lastDay.getDay();
      let daysToSubtract = currentDay - targetDayIndex;

      // If target day is same as today or later this week, go back a full week
      if (daysToSubtract <= 0) {
        daysToSubtract += 7;
      }

      lastDay.setDate(lastDay.getDate() - daysToSubtract);
      const converted = formatDateWithTime(lastDay, false);
      conversions.push(`"${match}" -> "${converted}"`);
      return converted;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 13: "last week" -> previous week range
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\blast\s+week\b/gi,
    () => {
      const lastWeekStart = new Date(referenceDate);
      const currentDay = lastWeekStart.getDay();
      // Go back to Monday of last week
      lastWeekStart.setDate(lastWeekStart.getDate() - ((currentDay + 6) % 7) - 7);

      return `week of ${formatDateWithTime(lastWeekStart, false)}`;
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN 14: "last month" -> previous month name
  // ═══════════════════════════════════════════════════════════════════════════
  result = result.replace(
    /\blast\s+month\b/gi,
    () => {
      const lastMonth = new Date(referenceDate);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const monthName = MONTH_NAMES[lastMonth.getMonth()];
      return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${lastMonth.getFullYear()}`;
    }
  );

  // Log all conversions made
  if (conversions.length > 0) {
    console.log(`   📅 convertRelativeDates: ${conversions.length} conversions made:`);
    conversions.forEach(c => console.log(`      ${c}`));
  }

  return result;
}

/**
 * Sanitize content before LLM processing
 * Removes potential injection attempts and normalizes whitespace
 */
function sanitizeContent(content: string): string {
  // Remove null bytes and control characters (except newlines/tabs)
  let sanitized = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize multiple newlines/spaces
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  sanitized = sanitized.replace(/[ \t]{3,}/g, '  ');

  // Trim and limit length
  sanitized = sanitized.trim().substring(0, MAX_CONTENT_LENGTH);

  return sanitized;
}

/**
 * Detect temporal expressions and calculate expiry timestamp
 */
function detectTemporalExpiry(content: string): number | undefined {
  const contentLower = content.toLowerCase();

  // Check if content contains event keywords
  const hasEventKeyword = EVENT_KEYWORDS.some(keyword =>
    contentLower.includes(keyword)
  );

  if (!hasEventKeyword) {
    return undefined;
  }

  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  // Check each temporal pattern
  for (const [, config] of Object.entries(TEMPORAL_PATTERNS)) {
    const match = content.match(config.regex);
    if (match) {
      if ('dynamic' in config && config.dynamic && match[1]) {
        const num = parseInt(match[1], 10);
        const multiplier = ('multiplier' in config ? config.multiplier : 1) || 1;
        return now + (num * multiplier * oneDay);
      } else if ('daysFromNow' in config) {
        return now + (config.daysFromNow * oneDay);
      }
    }
  }

  // If event keyword but no specific time, default to 7 days
  return now + (7 * oneDay);
}

/**
 * Extract entities using regex patterns (backup for LLM extraction)
 */
function extractEntitiesFromText(content: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seenNames = new Set<string>();

  // Person names - capitalized words together
  const personPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let match;
  while ((match = personPattern.exec(content)) !== null) {
    const name = match[1];
    // Filter out common non-names
    if (!seenNames.has(name) && !isCommonWord(name)) {
      seenNames.add(name);
      entities.push({ name, type: 'person' });
    }
  }

  // Organizations - look for Inc, Corp, LLC, etc.
  const orgPattern = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:Inc|Corp|LLC|Ltd|Company|Co)\b/gi;
  while ((match = orgPattern.exec(content)) !== null) {
    const name = match[0];
    if (!seenNames.has(name)) {
      seenNames.add(name);
      entities.push({ name, type: 'organization' });
    }
  }

  // Known tech companies
  const techCompanies = ['Google', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Facebook',
    'Netflix', 'Tesla', 'OpenAI', 'Anthropic', 'Stripe', 'Uber', 'Airbnb'];
  for (const company of techCompanies) {
    if (content.includes(company) && !seenNames.has(company)) {
      seenNames.add(company);
      entities.push({ name: company, type: 'organization' });
    }
  }

  // Locations - cities, countries
  const locationPattern = /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  while ((match = locationPattern.exec(content)) !== null) {
    const name = match[1];
    if (!seenNames.has(name) && !isCommonWord(name)) {
      seenNames.add(name);
      entities.push({ name, type: 'location' });
    }
  }

  // Dates
  const datePatterns = [
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,  // MM/DD/YYYY
    /\b(\d{4}-\d{2}-\d{2})\b/g,  // YYYY-MM-DD
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi,
  ];
  for (const pattern of datePatterns) {
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!seenNames.has(name)) {
        seenNames.add(name);
        entities.push({ name, type: 'date' });
      }
    }
  }

  return entities;
}

/**
 * Check if a word is a common non-entity word
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Which',
    'How', 'Why', 'Who', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
    'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December', 'User',
    'Today', 'Tomorrow', 'Yesterday', 'Morning', 'Afternoon', 'Evening', 'Night'
  ]);
  return commonWords.has(word);
}

/**
 * Detect if content has multi-speaker format and parse speakers
 */
function parseMultiSpeakerContent(content: string): Map<string, string[]> {
  const speakerStatements = new Map<string, string[]>();
  const lines = content.split('\n');

  let currentSpeaker: string | null = null;
  let currentStatement = '';

  for (const line of lines) {
    let matched = false;

    for (const pattern of SPEAKER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // Save previous speaker's statement
        if (currentSpeaker && currentStatement.trim()) {
          const statements = speakerStatements.get(currentSpeaker) || [];
          statements.push(currentStatement.trim());
          speakerStatements.set(currentSpeaker, statements);
        }

        currentSpeaker = match[1];
        currentStatement = line.replace(pattern, '');
        matched = true;
        break;
      }
    }

    if (!matched && currentSpeaker) {
      currentStatement += ' ' + line;
    }
  }

  // Don't forget the last speaker
  if (currentSpeaker && currentStatement.trim()) {
    const statements = speakerStatements.get(currentSpeaker) || [];
    statements.push(currentStatement.trim());
    speakerStatements.set(currentSpeaker, statements);
  }

  return speakerStatements;
}

/**
 * Determine memory kind based on content
 */
function determineMemoryKind(content: string): MemoryKind {
  const contentLower = content.toLowerCase();

  // FIRST: Check for RECURRING dates - these are FACTS, not events
  // Birthdays, anniversaries, etc. recur annually and are permanent biographical facts
  const recurringDatePatterns = [
    /\b(?:my\s+)?(?:birthday|anniversary|wedding\s+anniversary)\b/i,
    /\bborn\s+on\b/i,
    /\b(?:celebrates?|observes?)\s+(?:birthday|anniversary)\b/i,
  ];
  if (recurringDatePatterns.some(p => p.test(content))) {
    return 'fact';  // NOT 'event' - recurring dates are permanent facts
  }

  // Event indicators
  const eventIndicators = [
    'meeting', 'appointment', 'scheduled', 'event', 'deadline', 'due',
    'tomorrow', 'next week', 'on monday', 'on tuesday', 'will be',
    'going to', 'planning to', 'booked', 'reserved'
  ];
  if (eventIndicators.some(ind => contentLower.includes(ind))) {
    return 'event';
  }

  // Preference indicators
  const preferenceIndicators = [
    'prefer', 'like', 'love', 'hate', 'dislike', 'enjoy', 'favorite',
    'favourite', 'want', 'need', 'usually', 'always', 'never',
    'rather', 'instead of', 'better than', 'fan of', 'into'
  ];
  if (preferenceIndicators.some(ind => contentLower.includes(ind))) {
    return 'preference';
  }

  // Default to fact
  return 'fact';
}

/**
 * Validate extracted memory
 */
function validateMemory(memory: Partial<ExtractedMemory>): memory is ExtractedMemory {
  if (!memory.content || typeof memory.content !== 'string') {
    return false;
  }

  const content = memory.content.trim();

  // Length checks
  if (content.length < MIN_MEMORY_LENGTH || content.length > MAX_MEMORY_LENGTH) {
    return false;
  }

  // Confidence check
  if (typeof memory.confidence !== 'number' || memory.confidence < MIN_CONFIDENCE_THRESHOLD) {
    return false;
  }

  // Must have valid kind
  if (!memory.kind || !['fact', 'preference', 'event'].includes(memory.kind)) {
    return false;
  }

  return true;
}

/**
 * Deduplicate memories based on semantic similarity
 */
function deduplicateMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
  const unique: ExtractedMemory[] = [];
  const seenNormalized = new Set<string>();

  for (const memory of memories) {
    // Normalize for comparison
    const normalized = memory.content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check for exact duplicate
    if (seenNormalized.has(normalized)) {
      continue;
    }

    // Check for very similar (subset) memories
    let isDuplicate = false;
    for (const seen of seenNormalized) {
      // If one contains the other (allowing some variance)
      if (seen.includes(normalized) || normalized.includes(seen)) {
        // Keep the longer one
        if (normalized.length > seen.length) {
          seenNormalized.delete(seen);
          const idx = unique.findIndex(m =>
            m.content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() === seen
          );
          if (idx !== -1) unique.splice(idx, 1);
        } else {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      seenNormalized.add(normalized);
      unique.push(memory);
    }
  }

  return unique;
}

/**
 * Filter out broken/incomplete sentences, technical content, and programming language misclassifications
 *
 * This function filters out:
 * - Incomplete sentences ending in conjunctions/prepositions
 * - Facts containing code paths (src/, .ts, .js, etc.)
 * - Technical terms being treated as locations ("lives in files")
 * - Programming languages being treated as locations
 * - Content derived from technical documentation patterns
 */
function filterBrokenSentences(memories: ExtractedMemory[]): ExtractedMemory[] {
  // Programming languages that should never be treated as locations
  const programmingLanguages = new Set([
    'python', 'java', 'javascript', 'typescript', 'ruby', 'rust', 'go', 'golang',
    'swift', 'kotlin', 'scala', 'perl', 'haskell', 'elixir', 'clojure', 'erlang',
    'fortran', 'cobol', 'pascal', 'lisp', 'prolog', 'lua', 'julia', 'dart', 'groovy',
    'c++', 'c#', 'php', 'r', 'matlab', 'sql', 'html', 'css', 'bash', 'shell',
    'objective-c', 'assembly', 'vb', 'vba', 'powershell', 'f#', 'ocaml', 'nim',
    'zig', 'crystal', 'elm', 'purescript', 'reasonml', 'solidity', 'vyper'
  ]);

  // Technical/code-related terms that should not be treated as locations or personal facts
  const technicalTerms = new Set([
    'files', 'file', 'directory', 'directories', 'folder', 'folders', 'path', 'paths',
    'src', 'lib', 'bin', 'dist', 'build', 'node_modules', 'packages', 'modules',
    'config', 'configs', 'components', 'services', 'utils', 'helpers', 'models',
    'controllers', 'routes', 'views', 'templates', 'assets', 'public', 'private',
    'test', 'tests', 'spec', 'specs', '__tests__', 'fixtures', 'mocks', 'api',
    'endpoints', 'schemas', 'types', 'interfaces', 'classes', 'functions', 'methods',
    'database', 'databases', 'db', 'server', 'servers', 'client', 'clients',
    'backend', 'frontend', 'middleware', 'plugins', 'extensions', 'addons',
    'scripts', 'logs', 'temp', 'tmp', 'cache', 'vendor', 'deps', 'dependencies',
    'repos', 'repository', 'repositories', 'codebase', 'codebases', 'branch', 'branches',
    'commit', 'commits', 'merge', 'merges', 'pull', 'push', 'fetch', 'clone',
    'main', 'master', 'develop', 'staging', 'production', 'dev', 'prod'
  ]);

  // File extension patterns - matches common code file extensions
  const codeFileExtensions = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|cpp|c|h|hpp|css|scss|sass|less|html|xml|json|yaml|yml|md|txt|sql|sh|bash|zsh|vue|svelte|astro|mjs|cjs|swift|kt|groovy|scala|pl|pm|ex|exs|erl|hrl|hs|ml|fs|clj|cljs|r|rmd|jl|nim|zig|sol)(?:\s|$|,|;|:)/i;

  // Code path patterns (src/, lib/, etc.) - matches directory structures
  const codePathPattern = /\b(src|lib|dist|build|node_modules|packages?|components?|services?|utils?|helpers?|models?|controllers?|routes?|views?|templates?|assets?|public|private|tests?|specs?|__tests__|fixtures?|mocks?|api|auth|core|common|shared|vendor|deps|scripts|logs|config|db|database)[\/\\]/i;

  // Code syntax patterns - content that looks like code should be filtered
  const codeSyntaxPatterns = [
    /[{}].*[{}]/,                                // Multiple braces (likely code block)
    /=>/,                                        // Arrow functions
    /\bfunction\s*\(/,                           // function keyword
    /\bconst\s+\w+\s*=/,                         // const declaration
    /\blet\s+\w+\s*=/,                           // let declaration
    /\bvar\s+\w+\s*=/,                           // var declaration
    /\bclass\s+\w+\s*[{<]/,                      // class declaration
    /\binterface\s+\w+/,                         // interface declaration
    /\btype\s+\w+\s*=/,                          // type declaration
    /\bimport\s+.*\bfrom\b/,                     // import statement
    /\bexport\s+(?:default|const|function|class)/, // export statement
    /\brequire\s*\(/,                            // require()
    /\bmodule\.exports\b/,                       // module.exports
    /\[\s*\.\.\./,                               // spread operator in array
    /\{\s*\.\.\./,                               // spread operator in object
    /\$\{.*\}/,                                  // template literal
    /`[^`]*\$\{/,                                // template string
    /\(\s*\)\s*=>/,                              // arrow function signature
    /async\s+function/,                          // async function
    /await\s+\w+/,                               // await keyword
  ];

  return memories.filter(memory => {
    const content = memory.content.toLowerCase().trim();
    const originalContent = memory.content.trim();

    // Filter out incomplete sentences (ending in conjunctions/prepositions)
    const brokenEndings = [' and', ' or', ' the', ' a', ' an', ' in', ' on', ' at', ' to', ' for', ' with', ' from'];
    for (const ending of brokenEndings) {
      if (content.endsWith(ending)) {
        console.log(`   🚫 Filtering broken sentence: "${memory.content}"`);
        return false;
      }
    }

    // Filter out facts containing code file paths (e.g., "src/auth/jwt.ts")
    if (codePathPattern.test(originalContent)) {
      console.log(`   🚫 Filtering code path content: "${memory.content}"`);
      return false;
    }

    // Filter out facts containing file extensions (e.g., ".ts", ".js", ".py")
    if (codeFileExtensions.test(originalContent)) {
      console.log(`   🚫 Filtering file extension content: "${memory.content}"`);
      return false;
    }

    // Filter out "lives in [programming language]" nonsense
    const livesInMatch = content.match(/lives?\s+in\s+(\w+)/);
    if (livesInMatch) {
      const location = livesInMatch[1].toLowerCase();
      if (programmingLanguages.has(location)) {
        console.log(`   🚫 Filtering programming language as location: "${memory.content}"`);
        return false;
      }
      // Filter out "lives in files/directories/etc" - technical terms misinterpreted as locations
      // This catches "User lives in files" extracted from "Main files: src/..."
      if (technicalTerms.has(location)) {
        console.log(`   🚫 Filtering technical term as location: "${memory.content}"`);
        return false;
      }
    }

    // Filter out "from [programming language]" nonsense
    const fromMatch = content.match(/\bfrom\s+(\w+)$/);
    if (fromMatch && programmingLanguages.has(fromMatch[1].toLowerCase())) {
      console.log(`   🚫 Filtering programming language as origin: "${memory.content}"`);
      return false;
    }

    // Filter out facts that look like they're derived from technical documentation
    // e.g., "User lives in files" extracted from "Main files: src/..."
    const technicalContextPatterns = [
      /\b(?:main|entry|config|source|primary)\s+files?\b/i,  // "Main files:", "Entry file:"
      /\b(?:files?|paths?|directories?|folders?)\s*:/i,       // "Files:", "Path:", "Directory:"
      /\bimport(?:s|ed|ing)?\s+from\b/i,                      // "import from"
      /\bexport(?:s|ed|ing)?\s+(?:default|const|function|class)\b/i,  // "export default"
      /\brequire\s*\(/i,                                       // "require("
      /\bmodule\.exports\b/i,                                  // "module.exports"
      /\b(?:npm|yarn|pnpm)\s+(?:install|add|remove)\b/i,      // package manager commands
      /\bgit\s+(?:clone|pull|push|commit|branch)\b/i,         // git commands
    ];
    for (const pattern of technicalContextPatterns) {
      if (pattern.test(originalContent)) {
        console.log(`   🚫 Filtering technical context: "${memory.content}"`);
        return false;
      }
    }

    // Filter out content that looks like code (has code syntax patterns)
    for (const pattern of codeSyntaxPatterns) {
      if (pattern.test(originalContent)) {
        console.log(`   🚫 Filtering code syntax: "${memory.content}"`);
        return false;
      }
    }

    return true;
  });
}

/**
 * Filter out noise - low-value memories that shouldn't be stored
 * Noise patterns include:
 * - Greetings and small talk ("hello", "how are you")
 * - Acknowledgments ("ok", "thanks", "sure")
 * - Vague statements without specific information
 * - Questions without facts
 * - Overly generic statements
 * - Semantically nonsensical facts (technical terms as personal attributes)
 */
function filterNoise(memories: ExtractedMemory[]): ExtractedMemory[] {
  // Patterns that indicate noise/low-value content
  const noisePatterns = [
    // Greetings and small talk
    /^(hi|hello|hey|greetings)\b/i,
    /^how are you/i,
    /^nice to meet you/i,
    /^good (morning|afternoon|evening|night)/i,

    // Acknowledgments
    /^(ok|okay|sure|yes|no|yeah|nope|alright|got it)\b/i,
    /^(thanks|thank you|thx)\b/i,
    /^(you're welcome|no problem|np)\b/i,

    // Filler phrases
    /^(well|so|um|uh|like)\b/i,
    /^I (see|understand|got it)\b/i,
    /^(that's|thats) (nice|cool|great|interesting)\b/i,

    // Questions (usually not facts to remember)
    /^(what|who|when|where|why|how|can you|could you|would you|do you|are you)\b/i,
    /\?$/,

    // Generic/vague statements
    /^user (said|mentioned|stated|asked|asked about)\b/i,
    /^(something|someone|somewhere|sometime)\b/i,
    /^it is (good|bad|nice|interesting)\b/i,
  ];

  // Semantically nonsensical patterns - facts that don't make sense
  // These catch extraction errors where technical terms are misinterpreted
  const nonsensicalPatterns = [
    // "lives in" followed by technical/non-location terms
    // This catches "User lives in files" extracted from "Main files: src/..."
    /\blives?\s+in\s+(?:files?|directories?|folders?|paths?|src|lib|dist|build|config|modules?|packages?|components?|services?|utils?|code|data|api|endpoints?|database|server|client|backend|frontend|scripts|logs|cache|vendor|deps|main|master|develop|staging|production)\b/i,
    // "works at" followed by technical terms (not company names)
    /\bworks?\s+at\s+(?:src|lib|dist|build|config|modules?|packages?|files?|directories?|folders?)\b/i,
    // "is from" followed by technical terms
    /\bis\s+from\s+(?:files?|directories?|folders?|paths?|src|lib|dist|build|config|modules?|packages?)\b/i,
    // "based in" followed by technical terms
    /\bbased\s+in\s+(?:files?|directories?|folders?|paths?|src|lib|dist|build|config|modules?|packages?)\b/i,
    // "located in" followed by technical terms
    /\blocated\s+in\s+(?:files?|directories?|folders?|paths?|src|lib|dist|build|config|modules?|packages?)\b/i,
    // Organizations/companies having pets - this is nonsensical
    // Catches "Blue Bottle has cats named Luna" - companies don't have pets as personal attributes
    // Pets should ALWAYS be associated with "User", never with other entities
    /^(?!user)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+has\s+(?:a\s+)?(?:cats?|dogs?|pets?|birds?|fish|hamsters?|rabbits?)\s+(?:named|called)/i,
  ];

  // Minimum substantive word count (excluding stop words)
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
    'and', 'but', 'or', 'if', 'because', 'until', 'while', 'that',
    'which', 'who', 'whom', 'this', 'these', 'those', 'am', 'its',
    'user', 'users', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
  ]);

  return memories.filter(memory => {
    const content = memory.content.toLowerCase().trim();

    // Check against noise patterns
    for (const pattern of noisePatterns) {
      if (pattern.test(content)) {
        return false;
      }
    }

    // Check against semantically nonsensical patterns
    // These catch extraction errors like "User lives in files"
    for (const pattern of nonsensicalPatterns) {
      if (pattern.test(content)) {
        console.log(`   🚫 Filtering semantically nonsensical: "${memory.content}"`);
        return false;
      }
    }

    // Count substantive words
    const words = content.split(/\s+/);
    const substantiveWords = words.filter(word => {
      const cleaned = word.replace(/[^\w]/g, '');
      return cleaned.length > 2 && !stopWords.has(cleaned);
    });

    // Require at least 2 substantive words
    if (substantiveWords.length < 2) {
      return false;
    }

    // Check for minimum content length (already done in validateMemory but double-check)
    if (content.length < 10) {
      return false;
    }

    // Low confidence memories might be noise
    if (memory.confidence < 0.6) {
      // Only keep low-confidence if they have entities or are events
      if (!memory.entities?.length && memory.kind !== 'event') {
        return false;
      }
    }

    return true;
  });
}

// ============================================================================
// STATIC/DYNAMIC RECLASSIFICATION
// ============================================================================

/**
 * Reclassify memories using enhanced permanent fact detection
 *
 * This function fixes the bug where permanent biographical facts like:
 * - "User's name is Alex Johnson"
 * - "User was born on March 15, 1990"
 * - "User graduated from MIT"
 *
 * Were incorrectly classified as dynamic because they start with "User".
 * These are permanent facts that should be in the STATIC array.
 */
function reclassifyStaticDynamic(memories: ExtractedMemory[]): ExtractedMemory[] {
  return memories.map(memory => {
    const originalIsStatic = memory.isStatic;
    const newIsStatic = classifyMemoryStatic(memory.content);

    // Log reclassifications for debugging
    if (originalIsStatic !== newIsStatic) {
      console.log(`   🔄 Reclassified "${memory.content}" from ${originalIsStatic ? 'static' : 'dynamic'} to ${newIsStatic ? 'STATIC' : 'DYNAMIC'}`);
    }

    return {
      ...memory,
      isStatic: newIsStatic
    };
  });
}

/**
 * Internal classification function that checks permanent vs temporary patterns
 * This is the core logic for determining if a memory is static or dynamic.
 *
 * CRITICAL FIX: Check IDENTITY FACTS FIRST - these are ALWAYS STATIC.
 * Biographical facts like "name is", "born on", "graduated from"
 * should ALWAYS be static, regardless of whether they start with "User".
 *
 * The key insight is that identity facts (name, birthdate, education)
 * are IMMUTABLE - they don't change. Even if someone says "currently my name is",
 * that doesn't make sense - names are permanent biographical facts.
 */
function classifyMemoryStatic(content: string): boolean {
  const contentLower = content.toLowerCase();

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRST: Check for IDENTITY FACTS - these are ALWAYS STATIC
  // Identity facts are immutable biographical data that never changes.
  // ═══════════════════════════════════════════════════════════════════════════
  const isIdentityFact =
    // NAME patterns - permanent identity
    /\bname\s+is\b/i.test(content) ||
    /\bis\s+named\b/i.test(content) ||
    /\bcalled\s+[A-Z]/i.test(content) ||
    /\bknown\s+as\b/i.test(content) ||
    /\bgoes\s+by\b/i.test(content) ||
    /\bmy\s+name\b/i.test(content) ||
    // BIRTH/AGE/ANNIVERSARY patterns - permanent facts (recurring dates)
    /\bborn\s+(?:on|in)\b/i.test(content) ||
    /\bbirthday\s+(?:is|on)\b/i.test(content) ||
    /\banniversary\s+(?:is|on)\b/i.test(content) ||  // Wedding anniversary, etc.
    /\bwedding\s+anniversary\b/i.test(content) ||
    /\bbirthdate\b/i.test(content) ||
    /\bdate\s+of\s+birth\b/i.test(content) ||
    /\b\d+\s+years?\s+old\b/i.test(content) ||
    /\bage\s+(?:is\s+)?\d+\b/i.test(content) ||
    // EDUCATION patterns - permanent achievements
    /\bgraduated?\s+(?:from|at|in)\b/i.test(content) ||
    /\bdegree\s+(?:in|from)\b/i.test(content) ||
    /\b(?:bachelor|master|phd|doctorate|mba)\b/i.test(content) ||
    /\bstudied\s+(?:at|in)\b/i.test(content) ||
    /\balma\s+mater\b/i.test(content) ||
    /\bmajored?\s+in\b/i.test(content) ||
    // ORIGIN patterns - permanent
    /\bgrew\s+up\s+in\b/i.test(content) ||
    /\bnative\s+(?:of|to)\b/i.test(content) ||
    /\bhometown\b/i.test(content) ||
    /\boriginally\s+from\b/i.test(content) ||
    // FAMILY RELATIONSHIPS - permanent
    /\bmarried\s+to\b/i.test(content) ||
    /\b(?:wife|husband|spouse|partner)\s+is\b/i.test(content) ||
    /\b(?:mother|father|mom|dad)\s+is\b/i.test(content) ||
    /\b(?:son|daughter|child)\s+is\b/i.test(content) ||
    /\b(?:brother|sister|sibling)\s+is\b/i.test(content) ||
    // NATIONALITY - permanent
    /\bnationality\b/i.test(content) ||
    /\bcitizen(?:ship)?\b/i.test(content) ||
    /\bethnicity\b/i.test(content) ||
    /\bheritage\b/i.test(content);

  if (isIdentityFact) {
    // Identity facts are ALWAYS STATIC - no exceptions
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECOND: Check for TEMPORARY patterns - these indicate DYNAMIC facts
  // ═══════════════════════════════════════════════════════════════════════════
  for (const pattern of TEMPORARY_FACT_PATTERNS) {
    if (pattern.test(content)) {
      return false; // Dynamic - contains temporary indicators
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THIRD: Check remaining PERMANENT patterns (non-identity)
  // These are static unless overridden by temporary patterns (checked above)
  // ═══════════════════════════════════════════════════════════════════════════
  for (const pattern of PERMANENT_FACT_PATTERNS) {
    if (pattern.test(content)) {
      return true; // Static - permanent fact pattern
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOURTH: Heuristics for cases that don't match any pattern
  // ═══════════════════════════════════════════════════════════════════════════

  // Check if it starts with "User" - default to dynamic for User-prefixed
  if (contentLower.startsWith('user')) {
    return false; // Dynamic
  }

  // Check if it starts with a capitalized name pattern (First Last)
  const startsWithName = /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(content);
  if (startsWithName) {
    return true; // Static
  }

  // Check for named entity anywhere in the beginning
  const hasNamedEntity = /^[A-Z][a-z]+(?:'s)?\s/.test(content);
  if (hasNamedEntity) {
    return true; // Static
  }

  // Default to dynamic for uncertain cases
  return false;
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract memories from content with enhanced classification
 */
export async function extractMemories(
  content: string,
  entityContext?: string
): Promise<ExtractionResult> {
  // Input validation and sanitization
  if (!content || typeof content !== 'string') {
    return { memories: [], title: '', summary: '', entities: [], rawEntities: [] };
  }

  const sanitizedContent = sanitizeContent(content);

  if (sanitizedContent.length < MIN_CONTENT_LENGTH) {
    return { memories: [], title: '', summary: '', entities: [], rawEntities: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Convert ALL relative dates to absolute dates BEFORE LLM extraction
  // This ensures consistent date handling across all memories
  // Examples:
  //   "tomorrow at 3pm" -> "2026-02-20 at 15:00 UTC"
  //   "2 years ago" -> "2024-02-19"
  //   "next Friday" -> "2026-02-27"
  // ═══════════════════════════════════════════════════════════════════════════
  // SMART DATE REFERENCE: Use context date from text if available (e.g., session timestamps)
  // This allows relative dates like "yesterday" to be resolved relative to the conversation date
  // rather than today's date, preserving historical accuracy
  const contextDate = extractContextDate(sanitizedContent);
  const referenceDate = contextDate || new Date();
  const dateConvertedContent = convertRelativeDates(sanitizedContent, referenceDate);

  // Log conversion details for debugging
  if (dateConvertedContent !== sanitizedContent) {
    console.log(`   📅 Date conversion applied. Reference date: ${referenceDate.toISOString()}${contextDate ? ' (from text)' : ' (current)'}`);
    console.log(`   📅 Original: ${sanitizedContent.substring(0, 200)}...`);
    console.log(`   📅 Converted: ${dateConvertedContent.substring(0, 200)}...`);
  } else {
    console.log(`   📅 No relative dates found to convert. Reference date: ${referenceDate.toISOString()}${contextDate ? ' (from text)' : ' (current)'}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Resolve pronouns BEFORE extraction
  // This converts "She published 3 papers" to "Emily Chen published 3 papers"
  // Without this, pronouns stay unresolved and facts become meaningless
  // ═══════════════════════════════════════════════════════════════════════════
  const pronounResolvedContent = resolvePronouns(dateConvertedContent);

  // Check for multi-speaker content
  const speakerContent = parseMultiSpeakerContent(pronounResolvedContent);
  const isMultiSpeaker = speakerContent.size > 1;

  const model = getGenAI().getGenerativeModel({ model: 'gemini-3-flash-preview' });

  // Enhanced prompt - preserves entity names, roles, relationships, and numeric data
  const prompt = `Extract ALL facts from this content. PRESERVE original entity names - do NOT convert to "User".

CRITICAL RULES:
1. PRESERVE NAMES: If someone is named (e.g., "John Smith"), use their name in facts, NOT "User"
2. Only use "User" for first-person statements ("I am...", "My name is...") when no name is given
3. PRESERVE ROLES & TITLES: Include job titles, positions (e.g., "VP Engineering", "Senior Developer")
4. PRESERVE RELATIONSHIPS: Keep organizational relationships (e.g., "works at Acme Corp", "leads the team")
5. EXTRACT ALL NUMBERS: Budgets, team sizes, dates, percentages, amounts, years of experience
6. Create SEPARATE facts for each distinct piece of information
7. Programming languages are SKILLS, never locations!
7b. NEVER USE PRONOUNS: In extracted facts, NEVER use "he", "she", "his", "her", "him", "them", "they". Always repeat the person's FULL NAME.
    - WRONG: "He specializes in AI" or "His students love him"
    - RIGHT: "Robert Kim specializes in AI" or "Robert Kim's students love Robert Kim"

IMPORTANT - EXTRACT ALL PERSONAL RELATIONSHIPS:
8. FAMILY RELATIONSHIPS: Extract "User's boyfriend/girlfriend/husband/wife/partner is [Name]"
9. PET RELATIONSHIPS: Extract "User has a cat/dog named [Name]" or "User's pet is named [Name]"
10. PROFESSIONAL RELATIONSHIPS: Extract "[Name] works at [Company]" when mentioned about someone else
11. CHILDREN/PARENTS: Extract "User's son/daughter/mother/father is [Name]"
12. For third-party info: If someone says "My boyfriend Mike works at Google", extract BOTH:
    - "User's boyfriend is Mike"
    - "Mike works at Google"

CRITICAL - ATOMIC FACT EXTRACTION:
13. ATOMIZE FAMILY INFO: For EACH family member, extract SEPARATE facts for: relationship, name, age, occupation, traits
    - WRONG: "User has a wife Jennifer who is a pediatrician and a 7-year-old son Marcus"
    - RIGHT: Extract as SEPARATE facts:
      * "User's wife is Jennifer"
      * "Jennifer is a pediatrician"
      * "User's son is Marcus"
      * "Marcus is 7 years old"
14. ATOMIZE HOBBIES: For EACH hobby/activity, extract SEPARATE facts for: activity, frequency, duration, skill level
    - WRONG: "User plays tennis every Saturday and has been learning piano for 2 years"
    - RIGHT: Extract as SEPARATE facts:
      * "User plays tennis"
      * "User plays tennis every Saturday"
      * "User is learning piano"
      * "User has been learning piano for 2 years"
15. ONE FACT = ONE PIECE OF INFORMATION: Never combine multiple attributes into a single fact

CRITICAL - EXTRACT NEGATIVE FACTS AND FUTURE PLANS:
16. NEGATIVE FACTS: Extract what someone does NOT do or does NOT like
    - "User does not eat meat"
    - "User is vegetarian"
    - "User doesn't drink alcohol"
    - "User is allergic to peanuts"
17. DIETARY PREFERENCES: Extract all food-related facts
    - "User is pescatarian" (eats fish but not meat)
    - "User is vegan"
    - "User started eating fish again"
    - "User does not eat meat"
18. FUTURE PLANS & GOALS: Extract planned activities with dates
    - "Sarah is training for the SF Marathon in July"
    - "User plans to visit Japan in March"
    - "User is saving up for a house"
19. TRAINING & PREPARATION: Extract ongoing preparation activities
    - "User is training for a marathon"
    - "User is studying for the bar exam"
    - "User has marathon training runs on Saturdays"

CRITICAL - TEMPORAL EXPRESSIONS (NEVER LOSE DATES):
20. RELATIVE DATES: ALWAYS preserve the EXACT date expression from the input, including relative phrases
    - NEVER drop "the week before", "last", "a few days ago", "since", "starting from"
    - "the week before January 1, 2023" → MUST appear as "the week before January 1, 2023" in the fact
    - "last December" → MUST appear as "last December" in the fact
    - "since 2020" → MUST appear as "since 2020" in the fact
21. ALWAYS INCLUDE DATES: When a date/time is mentioned, ALWAYS include it VERBATIM in the fact
    - WRONG: "John joined a support group"
    - RIGHT: "John joined the support group the week before January 1, 2023"
    - WRONG: "User became vegetarian" (if date was given)
    - RIGHT: "User became vegetarian in March 2022"
22. DATE EXPRESSIONS TO PRESERVE: week before, week of, day after, month of, last [month], since [date], starting [date], around [date], in early/mid/late [period]

CRITICAL - INFER COMPOUND TERMS:
23. DIETARY INFERENCE: ALWAYS infer and extract dietary labels from behavior:
    - Eats fish + does not eat meat → EXTRACT: "User is pescatarian"
    - Does not eat meat but eats dairy/eggs → EXTRACT: "User is vegetarian"
    - Does not eat any animal products → EXTRACT: "User is vegan"
    - Started eating fish again + was vegetarian → EXTRACT: "User is pescatarian", "User started eating fish again"
24. LIFESTYLE INFERENCE: Infer lifestyle labels from behavior patterns:
    - Runs marathons + trains regularly → EXTRACT: "User is a runner"
    - Training for marathon → EXTRACT: "User is training for a marathon", "User is a runner"
    - Does not drink alcohol → EXTRACT: "User does not drink alcohol", "User is sober" (if applicable)

CRITICAL - CORRECT PRONOUN RESOLUTION:
25. When multiple people are mentioned, track WHO each fact belongs to:
    - If Sarah mentions "My friend Yuki is a software engineer at Nintendo":
      * RIGHT: "Yuki is a software engineer at Nintendo"
      * WRONG: "Sarah is a software engineer at Nintendo"
    - Use context clues: "My friend", "works at" indicates it's about the friend, not the speaker

EXAMPLES:

Input: "John Smith (VP Engineering, Acme Corp) approved the $2M budget for a 15-person team"
Output:
- "John Smith is VP Engineering at Acme Corp" (isStatic: true, kind: "fact")
- "John Smith approved the budget" (isStatic: true, kind: "event")
- "The budget is $2M" (isStatic: true, kind: "fact")
- "The team has 15 people" (isStatic: true, kind: "fact")

Input: "I am a software engineer with 10 years experience in Python and Go"
Output (no name given, use "User"):
- "User is a software engineer" (isStatic: false, kind: "fact")
- "User has 10 years experience in Python" (isStatic: false, kind: "fact")
- "User has 10 years experience in Go" (isStatic: false, kind: "fact")

Input: "My boyfriend Mike works at Google. We have a cat named Luna."
Output:
- "User's boyfriend is Mike" (isStatic: false, kind: "fact")
- "Mike works at Google" (isStatic: true, kind: "fact")
- "User has a cat named Luna" (isStatic: false, kind: "fact")

Input: "My wife Sarah is a doctor. Our dog Buddy loves the park."
Output:
- "User's wife is Sarah" (isStatic: false, kind: "fact")
- "Sarah is a doctor" (isStatic: true, kind: "fact")
- "User has a dog named Buddy" (isStatic: false, kind: "fact")

Input: "Sarah Chen, CEO of TechStart, mentioned their Q3 revenue was $5.2M"
Output:
- "Sarah Chen is CEO of TechStart" (isStatic: true, kind: "fact")
- "TechStart Q3 revenue was $5.2M" (isStatic: true, kind: "fact")

Input: "My wife Jennifer is a pediatrician. Our son Marcus is 7 years old and loves soccer."
Output (ATOMIZE each piece of info):
- "User's wife is Jennifer" (isStatic: false, kind: "fact")
- "Jennifer is a pediatrician" (isStatic: true, kind: "fact")
- "User's son is Marcus" (isStatic: false, kind: "fact")
- "Marcus is 7 years old" (isStatic: true, kind: "fact")
- "Marcus loves soccer" (isStatic: true, kind: "fact")

Input: "I play tennis every Saturday morning. I've been learning piano for 2 years."
Output (ATOMIZE activity, frequency, duration):
- "User plays tennis" (isStatic: false, kind: "fact")
- "User plays tennis every Saturday morning" (isStatic: false, kind: "fact")
- "User is learning piano" (isStatic: false, kind: "fact")
- "User has been learning piano for 2 years" (isStatic: false, kind: "fact")

Input: "John joined a support group the week before January 1, 2023."
Output (PRESERVE RELATIVE DATE EXPRESSION):
- "John joined a support group the week before January 1, 2023" (isStatic: true, kind: "event")
Note: The phrase "the week before January 1, 2023" MUST be preserved exactly as written.

Input: "I used to be vegetarian but started eating fish again last year."
Output (INFER DIETARY LABEL):
- "User was vegetarian" (isStatic: false, kind: "fact")
- "User started eating fish again last year" (isStatic: false, kind: "fact")
- "User is pescatarian" (isStatic: false, kind: "fact")
Note: Pescatarian is INFERRED from: was vegetarian + now eats fish.

Input: "Sarah is training for the SF Marathon in July. She has long runs on Saturdays."
Output (TRAINING + SCHEDULE):
- "Sarah is training for the SF Marathon" (isStatic: true, kind: "fact")
- "Sarah is training for the SF Marathon in July" (isStatic: true, kind: "fact")
- "Sarah has long runs on Saturdays" (isStatic: true, kind: "fact")
- "Sarah is a runner" (isStatic: true, kind: "fact")

Input: "We met around Christmas 2021, just a few days before New Year's."
Output (PRESERVE ALL DATE CONTEXT):
- "User met someone around Christmas 2021" (isStatic: false, kind: "event")
- "User met someone a few days before New Year's 2021" (isStatic: false, kind: "event")

CONTENT:
${pronounResolvedContent}

Return JSON:
{
  "memories": [
    {"content": "John Smith is VP Engineering at Acme Corp", "isStatic": true, "confidence": 0.95, "kind": "fact"},
    {"content": "John Smith approved the budget", "isStatic": true, "confidence": 0.9, "kind": "event"}
  ],
  "title": "Brief descriptive title",
  "summary": "Brief summary",
  "entities": [{"name": "John Smith", "type": "person"}, {"name": "Acme Corp", "type": "organization"}]
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Failed to parse extraction response');
      return await fallbackExtraction(sanitizedContent);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Process memories with validation and enrichment
    let memories: ExtractedMemory[] = (parsed.memories || [])
      .map((m: any): Partial<ExtractedMemory> => {
        const content = String(m.content || '').trim();
        const kind = (['fact', 'preference', 'event'].includes(m.kind) ? m.kind : determineMemoryKind(content)) as MemoryKind;

        // Calculate expiry for time-sensitive content
        let expiresAt: number | undefined;
        if (m.hasExpiry || kind === 'event') {
          expiresAt = detectTemporalExpiry(content);
        }

        return {
          content,
          isStatic: Boolean(m.isStatic),
          confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0.8)),
          kind,
          expiresAt,
          entities: Array.isArray(m.entities) ? m.entities.filter((e: any) => typeof e === 'string') : [],
          speaker: m.speaker || undefined
        };
      })
      .filter(validateMemory);

    // Deduplicate
    console.log(`   📝 Before dedup: ${memories.length} memories`);
    memories = deduplicateMemories(memories);
    console.log(`   📝 After dedup: ${memories.length} memories`);

    // Filter out broken sentences and misclassifications
    const beforeBroken = memories.length;
    memories = filterBrokenSentences(memories);
    if (memories.length < beforeBroken) {
      console.log(`   📝 filterBrokenSentences removed ${beforeBroken - memories.length} memories`);
    }

    // Filter out noise (low-value memories)
    const beforeNoise = memories.length;
    memories = filterNoise(memories);
    if (memories.length < beforeNoise) {
      console.log(`   📝 filterNoise removed ${beforeNoise - memories.length} memories`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Reclassify isStatic using enhanced permanent fact detection
    // This fixes the bug where permanent biographical facts like "User's name is Alex"
    // were incorrectly classified as dynamic by the LLM.
    // ═══════════════════════════════════════════════════════════════════════════
    memories = reclassifyStaticDynamic(memories);

    console.log(`   📝 Final extraction: ${memories.length} memories:`, memories.map(m => m.content));

    // Limit count
    memories = memories.slice(0, MAX_MEMORIES_PER_EXTRACTION);

    // Process entities
    const llmEntities: ExtractedEntity[] = (parsed.entities || [])
      .filter((e: any) => e && typeof e.name === 'string')
      .map((e: any) => ({
        name: e.name,
        type: ['person', 'organization', 'location', 'date', 'other'].includes(e.type)
          ? e.type
          : 'other'
      }));

    // Supplement with regex-extracted entities
    const regexEntities = extractEntitiesFromText(sanitizedContent);
    const allEntities = mergeEntities(llmEntities, regexEntities);

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Supplement LLM extraction with deterministic regex
    // This catches facts that LLM unreliably misses (like job titles)
    // ═══════════════════════════════════════════════════════════════════════════
    const personEntities = allEntities.filter(e => e.type === 'person');
    const primaryPerson = personEntities[0]?.name || null;

    // Also try to extract name from existing memories
    let extractedName = primaryPerson;
    if (!extractedName) {
      const nameMemory = memories.find(m =>
        m.content.toLowerCase().includes('name is') ||
        m.content.toLowerCase().includes("'s name")
      );
      if (nameMemory) {
        const nameMatch = nameMemory.content.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s name|name is ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        extractedName = nameMatch?.[1] || nameMatch?.[2] || null;
      }
    }

    const supplementedMemories = supplementWithRegex(dateConvertedContent, memories, extractedName);
    if (supplementedMemories.length > 0) {
      console.log(`   🔧 Regex supplement added ${supplementedMemories.length} memories LLM missed`);
      memories = deduplicateMemories([...memories, ...supplementedMemories]);
      // CRITICAL: Re-apply filters to catch any bad regex-supplemented memories
      memories = filterBrokenSentences(memories);
      memories = filterNoise(memories);
    }

    return {
      memories,
      title: parsed.title || '',
      summary: parsed.summary || dateConvertedContent.slice(0, 200),
      entities: allEntities,
      rawEntities: allEntities.map(e => e.name)
    };
  } catch (error) {
    console.error('Memory extraction error:', error);
    return await fallbackExtraction(dateConvertedContent);
  }
}

/**
 * Merge entity lists, preferring LLM-extracted types
 */
function mergeEntities(llmEntities: ExtractedEntity[], regexEntities: ExtractedEntity[]): ExtractedEntity[] {
  const entityMap = new Map<string, ExtractedEntity>();

  // Add LLM entities first (higher priority)
  for (const entity of llmEntities) {
    entityMap.set(entity.name.toLowerCase(), entity);
  }

  // Add regex entities if not already present
  for (const entity of regexEntities) {
    const key = entity.name.toLowerCase();
    if (!entityMap.has(key)) {
      entityMap.set(key, entity);
    }
  }

  return Array.from(entityMap.values());
}

// ============================================================================
// DETERMINISTIC REGEX SUPPLEMENT (Always runs after LLM)
// ============================================================================

/**
 * CRITICAL: Supplement LLM extraction with deterministic regex patterns
 * This catches facts that LLM might miss due to its unreliable nature.
 * Runs AFTER LLM extraction, not just as fallback.
 */
function supplementWithRegex(
  content: string,
  existingMemories: ExtractedMemory[],
  primaryPerson: string | null
): ExtractedMemory[] {
  const supplemented: ExtractedMemory[] = [];
  const existingLower = existingMemories.map(m => m.content.toLowerCase());
  console.log(`   🔍 supplementWithRegex: ${existingMemories.length} existing memories:`, existingLower);

  // Helper to check if fact already exists
  const hasFact = (keywords: string[]): boolean => {
    const result = existingLower.some(m => keywords.some(kw => m.includes(kw.toLowerCase())));
    if (result) {
      console.log(`   🔍 hasFact(${JSON.stringify(keywords)}) = true because existing memories include: ${existingLower.filter(m => keywords.some(kw => m.includes(kw.toLowerCase()))).join(' | ')}`);
    }
    return result;
  };

  // Helper to add memory if not duplicate
  const addIfMissing = (keywords: string[], memory: ExtractedMemory) => {
    if (!hasFact(keywords)) {
      supplemented.push(memory);
    }
  };

  const person = primaryPerson || 'User';
  const isStatic = !!primaryPerson;

  // ═══════════════════════════════════════════════════════════════════════════
  // JOB TITLE EXTRACTION (Most commonly missed by LLM)
  // ═══════════════════════════════════════════════════════════════════════════
  const jobPatterns = [
    // "I'm a data scientist" / "I am a software engineer" - captures 1-3 word job titles
    /(?:i'm|i am)\s+(?:a|an)\s+((?:senior|junior|lead|chief|principal|staff)?\s*[a-z]+(?:\s+[a-z]+)?)/gi,
    // "I work as a developer" / "work as senior engineer"
    /work(?:ing)?\s+as\s+(?:a|an)?\s*((?:senior|junior|lead|chief|principal|staff)?\s*[a-z]+(?:\s+[a-z]+){0,2})/gi,
    // "My role is data scientist" / "My job is engineer"
    /(?:my\s+)?(?:role|job|position|title|profession|occupation)\s+(?:is|as)\s+(?:a|an)?\s*((?:senior|junior|lead|chief|principal|staff)?\s*[a-z]+(?:\s+[a-z]+){0,2})/gi,
    // "Name works as a [title]" / "Name is working as [title]" (third-person)
    /(\w+(?:\s+\w+)?)\s+(?:works?|is\s+working)\s+as\s+(?:a|an)?\s*([a-z]+(?:\s+[a-z]+){0,3})/gi,
  ];

  console.log('   🔍 Regex supplement: checking job patterns...');
  for (const pattern of jobPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      console.log(`   🔍 Job pattern match: "${match[0]}" -> "${match[1]}"`);
      if (match[1]) {
        const jobTitle = match[1].trim();
        // Filter out non-job words
        if (jobTitle.length > 2 && !['a', 'an', 'the', 'at', 'in', 'for'].includes(jobTitle.toLowerCase())) {
          const alreadyExists = hasFact([jobTitle]);
          console.log(`   🔍 Job title "${jobTitle}" already exists: ${alreadyExists}`);
          if (!alreadyExists) {
            supplemented.push({
              content: `${person} is a ${jobTitle}`,
              isStatic,
              confidence: 0.85,
              kind: 'fact',
              entities: isStatic ? [person] : []
            });
            console.log(`   ✅ Added job: ${person} is a ${jobTitle}`);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const companyPatterns = [
    // "at Microsoft" / "at Google"
    /(?:work(?:ing)?|employed)\s+(?:at|for)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/gi,
    // "I'm at Microsoft"
    /(?:i'm|i am)\s+(?:at|with)\s+([A-Z][A-Za-z]+)/gi,
  ];

  for (const pattern of companyPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const company = match[1].trim();
        if (company.length > 1) {
          addIfMissing([company, 'works at', 'employed at'], {
            content: `${person} works at ${company}`,
            isStatic,
            confidence: 0.85,
            kind: 'fact',
            entities: isStatic ? [person, company] : [company]
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCATION EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const locationPatterns = [
    // "in Seattle" / "from Chicago"
    /(?:live|living|based|located|from|in)\s+(?:in\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  ];

  for (const pattern of locationPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const location = match[1].trim();
        // Filter out common non-locations (including programming languages!)
        const nonLocations = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
                            'Saturday', 'Sunday', 'January', 'February', 'March',
                            'April', 'May', 'June', 'July', 'August', 'September',
                            'October', 'November', 'December', 'The', 'This', 'That',
                            // Programming languages (often capitalized, not locations!)
                            'Python', 'Java', 'JavaScript', 'TypeScript', 'Ruby', 'Rust',
                            'Go', 'Golang', 'Swift', 'Kotlin', 'Scala', 'Perl', 'Haskell',
                            'Elixir', 'Clojure', 'Erlang', 'Fortran', 'Cobol', 'Pascal',
                            'Lisp', 'Prolog', 'Smalltalk', 'Lua', 'Julia', 'Dart', 'Groovy',
                            // Frameworks/technologies
                            'React', 'Angular', 'Vue', 'Django', 'Flask', 'Rails',
                            'Spring', 'Node', 'Express', 'FastAPI', 'Laravel', 'Symfony'];
        if (location.length > 2 && !nonLocations.includes(location)) {
          addIfMissing([location, 'lives in', 'from', 'based in'], {
            content: `${person} lives in ${location}`,
            isStatic,
            confidence: 0.75,
            kind: 'fact',
            entities: isStatic ? [person, location] : [location]
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGE EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const ageMatch = content.match(/(?:i'm|i am|aged?)\s+(\d{1,3})\s*(?:years?\s*old|y\.?o\.?)?/i);
  if (ageMatch) {
    const age = ageMatch[1];
    addIfMissing([age, 'years old', 'age'], {
      content: `${person} is ${age} years old`,
      isStatic,
      confidence: 0.9,
      kind: 'fact',
      entities: isStatic ? [person] : []
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALLERGY EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const allergyPatterns = [
    /(?:allergic\s+to|allergy\s+to|have\s+(?:a|an)?\s*(?:\w+\s+)?allergy)\s+(?:to\s+)?([a-z]+(?:\s+[a-z]+)?)/gi,
    /([a-z]+)\s+allergy/gi,
  ];

  for (const pattern of allergyPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const allergen = match[1].trim();
        if (allergen.length > 2) {
          addIfMissing([allergen, 'allergic', 'allergy'], {
            content: `${person} is allergic to ${allergen}`,
            isStatic,
            confidence: 0.9,
            kind: 'fact',
            entities: isStatic ? [person] : []
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PET EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const petPatterns = [
    /(?:have|own|got)\s+(?:a|an|\d+)?\s*(cat|dog|bird|fish|hamster|rabbit|guinea pig)s?\s*(?:named?\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)?))?/gi,
    /(?:my|our)\s+(cat|dog|bird)s?\s*(?:named?\s+)?([A-Z][a-z]+)?/gi,
  ];

  for (const pattern of petPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const petType = match[1].toLowerCase();
        const petNames = match[2] || '';
        const petContent = petNames
          ? `${person} has ${petType}s named ${petNames}`
          : `${person} has a ${petType}`;
        addIfMissing([petType, 'pet'], {
          content: petContent,
          isStatic,
          confidence: 0.85,
          kind: 'fact',
          entities: isStatic ? [person] : []
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THIRD-PARTY ENTITY EXTRACTION (Names with roles/organizations)
  // Pattern: "John Smith (VP Engineering, Acme Corp)" or "John Smith, VP at Acme"
  // ═══════════════════════════════════════════════════════════════════════════
  const thirdPartyPatterns = [
    // "John Smith (VP Engineering, Acme Corp)"
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(([^,)]+),\s*([^)]+)\)/g,
    // "John Smith, VP Engineering at Acme Corp"
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),\s*([A-Za-z\s]+?)\s+(?:at|of|from)\s+([A-Z][A-Za-z\s]+)/g,
    // "VP John Smith from Acme"
    /([A-Z][A-Za-z\s]+?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:from|at|of)\s+([A-Z][A-Za-z\s]+)/g,
  ];

  for (const pattern of thirdPartyPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      // Pattern 1 & 2: name, role, org
      const entityName = match[1]?.trim();
      const role = match[2]?.trim();
      const org = match[3]?.trim();

      if (entityName && role && org && entityName !== person) {
        // Extract: "John Smith is VP Engineering at Acme Corp"
        addIfMissing([entityName, role], {
          content: `${entityName} is ${role} at ${org}`,
          isStatic: true,
          confidence: 0.9,
          kind: 'fact',
          entities: [entityName, org]
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONAL RELATIONSHIP EXTRACTION (boyfriend, girlfriend, husband, wife, etc.)
  // CRITICAL: Extract family/romantic relationships like:
  // "My boyfriend Mike" -> "User's boyfriend is Mike"
  // "My sister Sarah" -> "User's sister is Sarah"
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('   🔍 Regex supplement: checking relationship patterns...');
  const relationshipPatterns = [
    // "My boyfriend Mike", "my girlfriend Sarah", "my husband John", "my wife Lisa"
    /\bmy\s+(boyfriend|girlfriend|husband|wife|partner|fiancé|fiancée|fiance|fiancee)\s+([A-Z][a-z]+)/gi,
    // "My son/daughter/mother/father/brother/sister Name"
    /\bmy\s+(son|daughter|mother|father|brother|sister|mom|dad|parent)\s+([A-Z][a-z]+)/gi,
    // Possessive: "My boyfriend's name is Mike"
    /\bmy\s+(boyfriend|girlfriend|husband|wife|partner|son|daughter|mother|father|brother|sister|mom|dad)'?s?\s+(?:name\s+is|is\s+named|called)\s+([A-Z][a-z]+)/gi,
    // "I have a boyfriend named Mike"
    /\bi\s+have\s+a\s+(boyfriend|girlfriend|husband|wife|partner|brother|sister)\s+(?:named|called)\s+([A-Z][a-z]+)/gi,
    // "Mike is my boyfriend" (reversed order)
    /\b([A-Z][a-z]+)\s+is\s+my\s+(boyfriend|girlfriend|husband|wife|partner|fiancé|fiancée|son|daughter|mother|father|brother|sister|mom|dad)\b/gi,
  ];

  for (const pattern of relationshipPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      console.log(`   🔍 Relationship pattern matched: "${match[0]}"`);
      let relation: string;
      let name: string;

      // Check if first capture is a name (starts with capital, not a relationship word)
      const relationWords = ['boyfriend', 'girlfriend', 'husband', 'wife', 'partner', 'son', 'daughter', 'mother', 'father', 'brother', 'sister', 'mom', 'dad', 'parent', 'fiancé', 'fiancée', 'fiance', 'fiancee'];
      if (/^[A-Z]/.test(match[1]) && match[2] && !relationWords.includes(match[1].toLowerCase())) {
        name = match[1].trim();
        relation = match[2].toLowerCase();
      } else if (match[1] && match[2]) {
        relation = match[1].toLowerCase();
        name = match[2].trim();
      } else {
        continue;
      }

      // Check for exact relationship match to avoid duplicates
      const exactMatch = `${relation} is ${name}`.toLowerCase();
      const hasExact = existingLower.some(m => m.includes(exactMatch));
      console.log(`   🔍 Checking relationship "${relation}" = "${name}": exists = ${hasExact}`);

      if (!hasExact) {
        supplemented.push({
          content: `User's ${relation} is ${name}`,
          isStatic: false,
          confidence: 0.9,
          kind: 'fact',
          entities: [name]
        });
        console.log(`   ✅ Added relationship: User's ${relation} is ${name}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIET/FOOD PREFERENCE EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════
  const dietPatterns = [
    // "I'm vegetarian", "I am vegan", "I'm pescatarian"
    /I(?:'m| am)\s+(vegetarian|vegan|pescatarian|flexitarian|fruitarian|raw vegan)/gi,
    // "I don't eat meat", "I do not eat pork"
    /I\s+(?:don't|do not|cannot|can't)\s+eat\s+(\w+(?:\s+\w+)?)/gi,
    // "I'm on a keto diet", "I follow a paleo diet"
    /I(?:'m| am)\s+on\s+(?:a\s+)?(\w+)\s+diet/gi,
    /I\s+follow\s+(?:a\s+)?(\w+)\s+diet/gi,
  ];

  for (const pattern of dietPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      if (match[1]) {
        const diet = match[1].trim().toLowerCase();
        // Check if it's a "don't eat X" pattern
        if (match[0].toLowerCase().includes("don't eat") || match[0].toLowerCase().includes("do not eat")) {
          addIfMissing([diet, "don't eat", "do not eat"], {
            content: `User doesn't eat ${diet}`,
            isStatic: false,
            confidence: 0.9,
            kind: 'preference',
            entities: []
          });
        } else if (match[0].toLowerCase().includes("diet")) {
          addIfMissing([diet, "diet"], {
            content: `User follows a ${diet} diet`,
            isStatic: false,
            confidence: 0.9,
            kind: 'preference',
            entities: []
          });
        } else {
          // "I'm vegetarian" style
          addIfMissing([diet], {
            content: `User is ${diet}`,
            isStatic: false,
            confidence: 0.9,
            kind: 'fact',
            entities: []
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PET RELATIONSHIP EXTRACTION (cat, dog named X)
  // CRITICAL: Always associate pets with USER, not nearby nouns like company names
  // "We have a cat named Luna" -> "User has a cat named Luna"
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('   🔍 Regex supplement: checking pet patterns...');
  const petNamePatterns = [
    // "our cat named Luna", "my dog named Max", "a cat named Whiskers"
    /\b(?:our|my|a)\s+(cat|dog|pet|bird|hamster|rabbit|fish)\s+(?:named|called)\s+([A-Z][a-z]+)/gi,
    // "We have a cat named Luna", "I have a dog named Max"
    /\b(?:we|i)\s+have\s+(?:a|an)\s+(cat|dog|pet|bird|hamster|rabbit|fish)\s+(?:named|called)\s+([A-Z][a-z]+)/gi,
    // "My dog Luna", "Our cat Max" (without named/called)
    /\b(?:my|our)\s+(cat|dog|pet|bird|hamster|rabbit|fish)\s+([A-Z][a-z]+)\b/gi,
    // "two cats named Luna and Max"
    /\b(?:two|three|\d+)\s+(cats?|dogs?|pets?)\s+(?:named|called)\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)*)/gi,
  ];

  for (const pattern of petNamePatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      console.log(`   🔍 Pet pattern matched: "${match[0]}"`);
      if (match[1] && match[2]) {
        const petType = match[1].toLowerCase().replace(/s$/, ''); // Normalize "cats" -> "cat"
        const petName = match[2].trim();

        // Check for exact pet match to avoid duplicates
        const exactMatch = `${petType} named ${petName}`.toLowerCase();
        const hasExact = existingLower.some(m => m.includes(exactMatch) || (m.includes(petType) && m.includes(petName.toLowerCase())));
        console.log(`   🔍 Checking pet "${petType}" named "${petName}": exists = ${hasExact}`);

        if (!hasExact) {
          supplemented.push({
            content: `User has a ${petType} named ${petName}`,
            isStatic: false,
            confidence: 0.9,
            kind: 'fact',
            entities: [petName]
          });
          console.log(`   ✅ Added pet: User has a ${petType} named ${petName}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THIRD-PARTY EMPLOYMENT EXTRACTION ([Name] works at [Company])
  // CRITICAL: Extract info about OTHER people's jobs like:
  // "Mike works at Google" -> "Mike works at Google"
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('   🔍 Regex supplement: checking third-party work patterns...');
  const thirdPartyWorkPatterns = [
    // "Mike works at Google", "Sarah works for Amazon"
    /\b([A-Z][a-z]+)\s+works?\s+(?:at|for)\s+([A-Z][A-Za-z]+)/gi,
  ];

  for (const pattern of thirdPartyWorkPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      console.log(`   🔍 Third-party work pattern matched: "${match[0]}"`);
      if (match[1] && match[2]) {
        const personName = match[1].trim();
        const company = match[2].trim();
        // Skip if it's the primary person (already handled) or generic words
        const skipWords = ['User', 'He', 'She', 'They', 'Who', 'Which', 'That'];
        if (!skipWords.includes(personName) && personName !== person) {
          // Check for exact match
          const exactMatch = `${personName.toLowerCase()} works at ${company.toLowerCase()}`;
          const hasExact = existingLower.some(m => m.includes(exactMatch) || (m.includes(personName.toLowerCase()) && m.includes('works') && m.includes(company.toLowerCase())));
          console.log(`   🔍 Checking "${personName} works at ${company}": exists = ${hasExact}`);

          if (!hasExact) {
            supplemented.push({
              content: `${personName} works at ${company}`,
              isStatic: true,
              confidence: 0.85,
              kind: 'fact',
              entities: [personName, company]
            });
            console.log(`   ✅ Added third-party work: ${personName} works at ${company}`);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOBBY/ACTIVITY EXTRACTION
  // CRITICAL: Extract hobbies, sports, activities with frequency and duration
  // Each piece of info becomes a SEPARATE fact for proper atomization
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('   🔍 Regex supplement: checking hobby/activity patterns...');

  // Common activities and sports
  const activities = 'tennis|golf|soccer|football|basketball|baseball|swimming|running|jogging|cycling|biking|hiking|yoga|pilates|gym|weightlifting|boxing|martial arts|karate|judo|taekwondo|chess|poker|photography|painting|drawing|cooking|baking|gardening|reading|writing|knitting|sewing|woodworking|fishing|hunting|skiing|snowboarding|surfing|skateboarding|climbing|dancing|singing|piano|guitar|violin|drums|flute|cello';

  // Pattern 1: "I play tennis" / "I do yoga" / "I practice piano"
  const hobbyPatterns = [
    new RegExp(`\\bi\\s+(?:play|do|practice|enjoy|love)\\s+(${activities})\\b`, 'gi'),
    // "I've been playing tennis" / "I have been learning piano"
    new RegExp(`\\bi(?:'ve|\\s+have)\\s+been\\s+(?:playing|doing|practicing|learning)\\s+(${activities})\\b`, 'gi'),
    // "I'm learning piano" / "I am studying guitar"
    new RegExp(`\\bi(?:'m|\\s+am)\\s+(?:learning|studying|practicing)\\s+(${activities})\\b`, 'gi'),
  ];

  for (const pattern of hobbyPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      if (match[1]) {
        const activity = match[1].trim().toLowerCase();
        console.log(`   🔍 Hobby pattern matched: "${match[0]}" -> "${activity}"`);

        // Check if base activity already exists
        const hasActivity = existingLower.some(m => m.includes(activity));
        if (!hasActivity) {
          // Determine verb based on activity type
          const isLearning = match[0].toLowerCase().includes('learning') || match[0].toLowerCase().includes('studying');
          const verb = isLearning ? 'is learning' : 'plays';
          supplemented.push({
            content: `User ${verb} ${activity}`,
            isStatic: false,
            confidence: 0.85,
            kind: 'fact',
            entities: []
          });
          console.log(`   ✅ Added hobby: User ${verb} ${activity}`);
        }
      }
    }
  }

  // Pattern 2: Frequency patterns "every Saturday", "twice a week", "on weekends"
  const frequencyPatterns = [
    // "I play tennis every Saturday"
    new RegExp(`\\bi\\s+(?:play|do|practice)\\s+(${activities})\\s+(every\\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|twice\\s+a\\s+week|once\\s+a\\s+week|on\\s+weekends?|daily|weekly)`, 'gi'),
    // "every Saturday I play tennis"
    new RegExp(`(every\\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\\s+weekends?)\\s+i\\s+(?:play|do|practice)\\s+(${activities})`, 'gi'),
  ];

  for (const pattern of frequencyPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      let activity: string;
      let frequency: string;

      // Determine which capture group is which based on pattern
      if (match[1] && match[2]) {
        // Check if first group looks like a frequency
        if (/every|twice|once|daily|weekly|weekend/i.test(match[1])) {
          frequency = match[1].trim().toLowerCase();
          activity = match[2].trim().toLowerCase();
        } else {
          activity = match[1].trim().toLowerCase();
          frequency = match[2].trim().toLowerCase();
        }

        console.log(`   🔍 Frequency pattern matched: "${match[0]}" -> "${activity}" "${frequency}"`);

        // Check if frequency fact already exists
        const hasFrequency = existingLower.some(m => m.includes(activity) && m.includes(frequency));
        if (!hasFrequency) {
          supplemented.push({
            content: `User plays ${activity} ${frequency}`,
            isStatic: false,
            confidence: 0.85,
            kind: 'fact',
            entities: []
          });
          console.log(`   ✅ Added hobby frequency: User plays ${activity} ${frequency}`);
        }
      }
    }
  }

  // Pattern 3: Duration patterns "for 2 years", "since 2020"
  const durationPatterns = [
    // "I've been learning piano for 2 years"
    new RegExp(`\\bi(?:'ve|\\s+have)\\s+been\\s+(?:playing|doing|practicing|learning)\\s+(${activities})\\s+(?:for\\s+(\\d+\\s+(?:year|month|week|day)s?)|since\\s+(\\d{4}))`, 'gi'),
    // "I started playing tennis 5 years ago"
    new RegExp(`\\bi\\s+started\\s+(?:playing|doing|practicing|learning)\\s+(${activities})\\s+(\\d+\\s+(?:year|month|week|day)s?\\s+ago)`, 'gi'),
  ];

  for (const pattern of durationPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      if (match[1]) {
        const activity = match[1].trim().toLowerCase();
        const duration = (match[2] || match[3] || '').trim().toLowerCase();

        if (duration) {
          console.log(`   🔍 Duration pattern matched: "${match[0]}" -> "${activity}" for "${duration}"`);

          // Check if duration fact already exists
          const hasDuration = existingLower.some(m => m.includes(activity) && (m.includes(duration) || m.includes('year') || m.includes('since')));
          if (!hasDuration) {
            const durationText = match[0].includes('since') ? `since ${duration}` : `for ${duration}`;
            supplemented.push({
              content: `User has been learning ${activity} ${durationText}`,
              isStatic: false,
              confidence: 0.85,
              kind: 'fact',
              entities: []
            });
            console.log(`   ✅ Added hobby duration: User has been learning ${activity} ${durationText}`);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAMILY MEMBER ATTRIBUTE EXTRACTION (age, occupation of family members)
  // CRITICAL: Extract SEPARATE facts for each family member's attributes
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('   🔍 Regex supplement: checking family member attribute patterns...');

  // Pattern: "[Name] is a [occupation]" or "[Name] is [age] years old"
  const familyOccupationPatterns = [
    // "Jennifer is a pediatrician", "Mike is an engineer"
    /\b([A-Z][a-z]+)\s+is\s+(?:a|an)\s+(doctor|nurse|teacher|engineer|lawyer|accountant|manager|director|chef|pilot|architect|scientist|professor|pediatrician|surgeon|dentist|pharmacist|therapist|analyst|consultant|designer|developer|programmer|writer|artist|musician|actor|photographer|journalist|editor|marketer|salesperson|realtor|contractor|plumber|electrician|mechanic|carpenter|firefighter|police officer|paramedic|veterinarian)\b/gi,
    // "Sarah works as a doctor"
    /\b([A-Z][a-z]+)\s+works\s+as\s+(?:a|an)\s+(\w+(?:\s+\w+)?)/gi,
  ];

  for (const pattern of familyOccupationPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      if (match[1] && match[2]) {
        const personName = match[1].trim();
        const occupation = match[2].trim().toLowerCase();

        // Skip if it's the primary person
        if (personName === person) continue;

        console.log(`   🔍 Family occupation pattern matched: "${match[0]}" -> "${personName}" is "${occupation}"`);

        // Check if this occupation fact already exists
        const hasOccupation = existingLower.some(m => m.includes(personName.toLowerCase()) && m.includes(occupation));
        if (!hasOccupation) {
          supplemented.push({
            content: `${personName} is a ${occupation}`,
            isStatic: true,
            confidence: 0.85,
            kind: 'fact',
            entities: [personName]
          });
          console.log(`   ✅ Added family occupation: ${personName} is a ${occupation}`);
        }
      }
    }
  }

  // Pattern: "[Name] is [age]" or "[Name] is [age] years old"
  const familyAgePatterns = [
    // "Marcus is 7 years old", "Jennifer is 35"
    /\b([A-Z][a-z]+)\s+is\s+(\d{1,3})\s*(?:years?\s*old)?(?:\s|,|\.)/gi,
    // "7-year-old Marcus", "our 7 year old son Marcus"
    /\b(\d{1,3})[-\s]?year[-\s]?old\s+(?:son|daughter|child|kid|boy|girl)?\s*([A-Z][a-z]+)/gi,
  ];

  for (const pattern of familyAgePatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      let personName: string;
      let age: string;

      // Determine capture group order
      if (/^\d+$/.test(match[1])) {
        age = match[1];
        personName = match[2]?.trim() || '';
      } else {
        personName = match[1]?.trim() || '';
        age = match[2];
      }

      if (personName && age && personName !== person) {
        console.log(`   🔍 Family age pattern matched: "${match[0]}" -> "${personName}" is "${age}"`);

        // Check if this age fact already exists
        const hasAge = existingLower.some(m => m.includes(personName.toLowerCase()) && m.includes(age) && m.includes('year'));
        if (!hasAge) {
          supplemented.push({
            content: `${personName} is ${age} years old`,
            isStatic: true,
            confidence: 0.85,
            kind: 'fact',
            entities: [personName]
          });
          console.log(`   ✅ Added family age: ${personName} is ${age} years old`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TECHNICAL/CODE CONTEXT EXTRACTION (Repos, tech stack, bugs)
  // Extracts structured facts from technical conversations
  // Each piece of technical info becomes a SEPARATE fact
  // ═══════════════════════════════════════════════════════════════════════════

  // Repo/project name extraction: "working on auth-service repo"
  const repoPatterns = [
    /working\s+on\s+(?:the\s+)?(\w+[-\w]*)\s+repo(?:sitory)?/gi,
    /working\s+on\s+(?:the\s+)?(\w+[-\w]*)\s+project/gi,
    /(?:in|on)\s+(?:the\s+)?(\w+[-\w]*)\s+(?:repo|repository|codebase)/gi,
  ];

  for (const pattern of repoPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      if (match[1]) {
        const repoName = match[1].trim();
        // Filter out common non-repo words
        const skipWords = ['the', 'this', 'that', 'a', 'an', 'my', 'our', 'your'];
        if (repoName.length > 1 && !skipWords.includes(repoName.toLowerCase())) {
          addIfMissing([repoName, 'repo', 'repository', 'project'], {
            content: `User is working on ${repoName} repo`,
            isStatic: false,
            confidence: 0.85,
            kind: 'fact',
            entities: []
          });
        }
      }
    }
  }

  // Tech stack extraction: "Node.js 18", "Express 4.18", "PostgreSQL 15", etc.
  // IMPORTANT: Each technology becomes a SEPARATE fact
  const techStackPattern = /(Node\.js|Express|PostgreSQL|Redis|MongoDB|React|Vue|Angular|Django|Flask|FastAPI|Spring|Laravel|Rails|Next\.js|Nuxt|Svelte|Prisma|TypeORM|Sequelize|Mongoose|GraphQL|REST|gRPC|Docker|Kubernetes|AWS|GCP|Azure|Terraform|Ansible|Jenkins|GitHub Actions|CircleCI|Travis|Webpack|Vite|Rollup|ESLint|Prettier|Jest|Mocha|Pytest|JUnit|Cypress|Playwright|Selenium|TypeScript|JavaScript|Python|Java|Go|Rust|Ruby|PHP|C\+\+|C#|Kotlin|Swift|Scala|Elixir|Haskell|MySQL|MariaDB|SQLite|Oracle|SQL Server|Cassandra|DynamoDB|Elasticsearch|Kafka|RabbitMQ|NGINX|Apache|Caddy|Traefik)\s*(\d+(?:\.\d+)?(?:\.\d+)?)?/gi;

  const techMatches = [...content.matchAll(techStackPattern)];
  const seenTech = new Set<string>();

  for (const match of techMatches) {
    if (match[1]) {
      const tech = match[1].trim();
      const version = match[2]?.trim() || '';
      const techKey = tech.toLowerCase();

      // Avoid duplicates within this extraction
      if (!seenTech.has(techKey)) {
        seenTech.add(techKey);

        const techFact = version
          ? `User uses ${tech} ${version}`
          : `User uses ${tech}`;

        addIfMissing([tech.toLowerCase()], {
          content: techFact,
          isStatic: false,
          confidence: 0.85,
          kind: 'fact',
          entities: []
        });
      }
    }
  }

  // Stack description extraction: "Stack: Node.js 18, Express 4.18, PostgreSQL 15"
  // This handles comma-separated tech lists
  const stackListPattern = /(?:stack|tech stack|using|technologies?):\s*([^.]+)/gi;
  const stackMatches = [...content.matchAll(stackListPattern)];

  for (const match of stackMatches) {
    if (match[1]) {
      // Split by comma and extract each tech
      const techList = match[1].split(/[,;]/);
      for (const techItem of techList) {
        const techMatch = techItem.match(/([\w.+-]+)\s*(\d+(?:\.\d+)?(?:\.\d+)?)?/);
        if (techMatch && techMatch[1]) {
          const tech = techMatch[1].trim();
          const version = techMatch[2]?.trim() || '';
          const techKey = tech.toLowerCase();

          // Skip common non-tech words
          const skipWords = ['and', 'or', 'with', 'using', 'the', 'a', 'an'];
          if (tech.length > 1 && !skipWords.includes(techKey) && !seenTech.has(techKey)) {
            seenTech.add(techKey);

            const techFact = version
              ? `User uses ${tech} ${version}`
              : `User uses ${tech}`;

            addIfMissing([tech.toLowerCase()], {
              content: techFact,
              isStatic: false,
              confidence: 0.8,
              kind: 'fact',
              entities: []
            });
          }
        }
      }
    }
  }

  // Bug/issue/error description extraction
  const bugPatterns = [
    /(?:bug|issue|error|problem):\s*([^.]+)/gi,
    /(?:debugging|fixing|investigating)\s+(?:a|an|the)?\s*([^.]+(?:bug|issue|error|problem)[^.]*)/gi,
    /(?:there'?s?\s+(?:a|an)?\s*)?(bug|issue|error)\s+(?:in|with|where)\s+([^.]+)/gi,
  ];

  for (const pattern of bugPatterns) {
    const matches = [...content.matchAll(pattern)];
    for (const match of matches) {
      // Get the description (either match[1] or match[2] depending on pattern)
      const description = (match[2] || match[1])?.trim();
      if (description && description.length > 5 && description.length < 200) {
        // Clean up the description
        const cleanDesc = description
          .replace(/^\s*(a|an|the)\s+/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleanDesc.length > 5) {
          addIfMissing([cleanDesc.substring(0, 20).toLowerCase()], {
            content: `User is dealing with: ${cleanDesc}`,
            isStatic: false,
            confidence: 0.75,
            kind: 'fact',
            entities: []
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NUMERIC DATA EXTRACTION (Budgets, team sizes, percentages, amounts)
  // ═══════════════════════════════════════════════════════════════════════════
  const numericPatterns = [
    // Budget: "$2M budget", "$500,000 budget", "budget of $2M"
    { regex: /\$(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:budget|funding)/gi, template: 'The budget is ${}' },
    { regex: /budget\s+(?:of|is|was)\s*\$(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)/gi, template: 'The budget is ${}' },
    // Team size: "15-person team", "team of 15", "15 team members"
    { regex: /(\d+)[-\s]person\s+team/gi, template: 'The team has {} people' },
    { regex: /team\s+of\s+(\d+)/gi, template: 'The team has {} people' },
    { regex: /(\d+)\s+team\s+members/gi, template: 'The team has {} members' },
    // Revenue/Sales: "$5.2M revenue", "revenue of $5.2M"
    { regex: /\$(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:revenue|sales|profit)/gi, template: 'Revenue is ${}' },
    { regex: /(?:revenue|sales|profit)\s+(?:of|is|was)\s*\$(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)/gi, template: 'Revenue is ${}' },
    // Percentages: "25% growth", "growth of 25%"
    { regex: /(\d+(?:\.\d+)?%)\s*(?:growth|increase|decrease|reduction)/gi, template: 'Growth rate is {}' },
    // Headcount: "500 employees", "headcount of 500"
    { regex: /(\d+(?:,\d{3})*)\s+employees/gi, template: 'Company has {} employees' },
    { regex: /headcount\s+(?:of|is|was)\s*(\d+(?:,\d{3})*)/gi, template: 'Headcount is {}' },
  ];

  for (const { regex, template } of numericPatterns) {
    const matches = [...content.matchAll(regex)];
    for (const match of matches) {
      if (match[1]) {
        const value = match[1];
        const factContent = template.replace('{}', value);
        // Use the first word as keyword to avoid duplicates
        const keyword = factContent.split(' ').slice(0, 3).join(' ').toLowerCase();
        addIfMissing([keyword, value], {
          content: factContent,
          isStatic: true,
          confidence: 0.85,
          kind: 'fact',
          entities: []
        });
      }
    }
  }

  return supplemented;
}

// ============================================================================
// FALLBACK EXTRACTION
// ============================================================================

/**
 * Fallback extraction using regex when LLM fails
 */
async function fallbackExtraction(content: string): Promise<ExtractionResult> {
  const memories: ExtractedMemory[] = [];
  const entities = extractEntitiesFromText(content);

  // Extract person names for attribution
  const personEntities = entities.filter(e => e.type === 'person');
  const primaryPerson = personEntities[0]?.name;

  // Extract name patterns
  const nameMatch = content.match(/(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (nameMatch) {
    const name = nameMatch[1];
    memories.push({
      content: `${name}'s name is ${name}`,
      isStatic: true,
      confidence: 0.7,
      kind: 'fact',
      entities: [name]
    });
  }

  // Extract work info
  const workMatch = content.match(/(?:work|working)\s+(?:at|for)\s+([A-Z][A-Za-z]+)/i);
  if (workMatch) {
    const company = workMatch[1];
    if (primaryPerson) {
      memories.push({
        content: `${primaryPerson} works at ${company}`,
        isStatic: true,
        confidence: 0.7,
        kind: 'fact',
        entities: [primaryPerson, company]
      });
    } else {
      memories.push({
        content: `User works at ${company}`,
        isStatic: false,
        confidence: 0.7,
        kind: 'fact',
        entities: [company]
      });
    }
  }

  // Extract preferences
  const prefPatterns = [
    { regex: /(?:i )?(?:prefer|like|love|enjoy)\s+(.+?)(?:\.|,|$)/gi, kind: 'preference' as MemoryKind },
    { regex: /(?:my favorite|favourite)\s+(.+?)\s+is\s+(.+?)(?:\.|,|$)/gi, kind: 'preference' as MemoryKind }
  ];

  for (const { regex, kind } of prefPatterns) {
    const matches = content.matchAll(regex);
    for (const match of matches) {
      if (match[1] && match[1].length > 2 && match[1].length < 100) {
        const memContent = `User ${match[0].replace(/^i\s+/i, '').trim()}`;
        memories.push({
          content: memContent,
          isStatic: false,
          confidence: 0.5,
          kind,
          entities: []
        });
      }
    }
  }

  // Extract events with temporal markers
  for (const keyword of EVENT_KEYWORDS) {
    const eventRegex = new RegExp(`\\b${keyword}\\b[^.]*(?:tomorrow|next week|today|monday|tuesday|wednesday|thursday|friday)[^.]*\\.?`, 'gi');
    const eventMatches = content.matchAll(eventRegex);
    for (const match of eventMatches) {
      if (match[0].length > 10 && match[0].length < 200) {
        memories.push({
          content: `User has ${match[0].trim()}`,
          isStatic: false,
          confidence: 0.6,
          kind: 'event',
          expiresAt: detectTemporalExpiry(match[0]),
          entities: []
        });
      }
    }
  }

  // Generate simple title
  const title = primaryPerson
    ? `${primaryPerson} - Personal Information`
    : 'User Information';

  return {
    memories: deduplicateMemories(memories).slice(0, MAX_MEMORIES_PER_EXTRACTION),
    title,
    summary: content.slice(0, 200),
    entities,
    rawEntities: entities.map(e => e.name)
  };
}

// ============================================================================
// ADDITIONAL EXPORTS
// ============================================================================

/**
 * Generate a smart title for content
 */
export async function generateTitle(content: string): Promise<string> {
  const sanitized = sanitizeContent(content).slice(0, 50000); // Use more context for better titles
  const model = getGenAI().getGenerativeModel({ model: 'gemini-3-flash-preview' });

  const prompt = `Generate a concise, descriptive title for this content.

Examples of good titles:
- "Sarah Johnson - 28-year-old Google Product Manager in San Francisco with Dog Max"
- "User Preferences: Dark Mode, Vegetarian, Nut Allergy, Sci-Fi Reader, Python Programmer"
- "Google AI Feature Team Overview"
- "Weekly Meeting Notes - Product Launch Planning"

Content:
"""
${sanitized}
"""

Respond with ONLY the title, nothing else. Keep it under 100 characters.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text()?.trim() || '';
  } catch (error) {
    console.error('Title generation error:', error);
    return '';
  }
}

/**
 * Generate a summary for content
 */
export async function generateSummary(content: string): Promise<string> {
  const sanitized = sanitizeContent(content).slice(0, 50000); // Use more context
  const model = getGenAI().getGenerativeModel({ model: 'gemini-3-flash-preview' });

  const prompt = `Summarize this content in 1-2 sentences:

${sanitized}

Respond with ONLY the summary.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text()?.trim() || sanitized.slice(0, 200);
  } catch (error) {
    return sanitized.slice(0, 200);
  }
}

/**
 * Classify if a memory should be static or dynamic (exported version)
 * This is a public API that uses the internal classifyMemoryStatic function.
 */
export function classifyMemory(memory: string): boolean {
  return classifyMemoryStatic(memory);
}

/**
 * Classify memory kind from content
 */
export function classifyMemoryKind(content: string): MemoryKind {
  return determineMemoryKind(content);
}

/**
 * Check if content contains temporal markers
 */
export function hasTemporalContent(content: string): boolean {
  const contentLower = content.toLowerCase();

  // Check for event keywords
  if (!EVENT_KEYWORDS.some(kw => contentLower.includes(kw))) {
    return false;
  }

  // Check for temporal patterns
  return Object.values(TEMPORAL_PATTERNS).some(config => config.regex.test(content));
}

/**
 * Calculate expiry timestamp for content
 */
export function calculateExpiry(content: string): number | undefined {
  return detectTemporalExpiry(content);
}

/**
 * Convert relative dates to absolute dates in text
 * Exported for testing and external use
 *
 * @param text - Text containing relative date expressions
 * @param referenceDate - Reference date for calculations (defaults to now)
 * @returns Text with relative dates converted to absolute dates
 *
 * Examples:
 *   convertDates("meeting tomorrow at 3pm") -> "meeting 2026-02-20 at 15:00 UTC"
 *   convertDates("2 years ago") -> "2024-02-19"
 *   convertDates("next Friday at 10am") -> "2026-02-27 at 10:00 UTC"
 */
export function convertDates(text: string, referenceDate?: Date): string {
  return convertRelativeDates(text, referenceDate || new Date());
}

// ============================================================================
// CONTRADICTION SUPERSEDING (SEMANTIC SIMILARITY-BASED)
// ============================================================================

/**
 * Patterns for extracting entity + attribute from memory content
 * Used to detect semantic contradictions (same entity + same attribute = contradiction)
 */
const ENTITY_ATTRIBUTE_PATTERNS = [
  // "X lives in Y" -> entity=X, attribute=location
  { regex: /^(\w+(?:\s+\w+)?)\s+lives?\s+in\b/i, attribute: 'location' },
  // "X works at Y" -> entity=X, attribute=workplace
  { regex: /^(\w+(?:\s+\w+)?)\s+works?\s+(?:at|for)\b/i, attribute: 'workplace' },
  // "X is a Y" (job) -> entity=X, attribute=job
  { regex: /^(\w+(?:\s+\w+)?)\s+is\s+(?:a|an)\s+\w+(?:\s+\w+)?\s*$/i, attribute: 'job' },
  // "X's favorite Y is Z" -> entity=X, attribute=favorite_Y
  { regex: /^(\w+(?:'s)?)\s+favorite\s+(\w+)\s+is\b/i, attribute: (m: RegExpMatchArray) => `favorite_${m[2]}` },
  // "User's location is Y" -> entity=User, attribute=location
  { regex: /^(\w+(?:'s)?)\s+(?:location|address|residence)\s+is\b/i, attribute: 'location' },
  // "User prefers Y" -> entity=User, attribute=preferences
  { regex: /^(\w+)\s+prefers?\b/i, attribute: 'preference' },
  // Generic "X is Y years old" -> entity=X, attribute=age
  { regex: /^(\w+(?:\s+\w+)?)\s+is\s+\d+\s+years?\s+old/i, attribute: 'age' },
];

/**
 * Extract entity and attribute from memory content for contradiction detection
 */
function extractEntityAttribute(content: string): { entity: string; attribute: string } | null {
  for (const pattern of ENTITY_ATTRIBUTE_PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      const entity = match[1].replace(/'s$/i, '').toLowerCase();
      const attribute = typeof pattern.attribute === 'function'
        ? pattern.attribute(match)
        : pattern.attribute;
      return { entity, attribute };
    }
  }
  return null;
}

/**
 * Check for semantic contradictions and supersede old memories
 *
 * This function:
 * 1. Searches for semantically similar memories (similarity > 0.85)
 * 2. Checks if they have the same entity + attribute (potential contradiction)
 * 3. Marks old memory as is_latest=false
 * 4. Creates a 'supersedes' relationship link
 *
 * @param userId - User ID
 * @param newContent - New memory content
 * @param embedding - Embedding vector for the new memory
 * @param convex - Convex client
 * @returns IDs of superseded memories (if any)
 */
async function checkAndSupersede(
  userId: string,
  newContent: string,
  embedding: number[],
  convex: any
): Promise<string[]> {
  const supersededIds: string[] = [];

  try {
    // Search for semantically similar memories (vectorSearch is an Action, not Query)
    const similarMemories = await convex.action('vectorSearch:searchMemories' as any, {
      userId,
      embedding,
      limit: 10,
      minScore: 0.85,  // High similarity threshold for contradiction detection
    });

    if (!similarMemories || similarMemories.length === 0) {
      return supersededIds;
    }

    // Extract entity+attribute from new memory
    const newEntityAttr = extractEntityAttribute(newContent);
    if (!newEntityAttr) {
      // If we can't extract entity+attribute, skip contradiction detection
      return supersededIds;
    }

    console.log(`   🔍 Checking contradictions for: entity="${newEntityAttr.entity}", attr="${newEntityAttr.attribute}"`);

    for (const existingMem of similarMemories) {
      // Skip if not marked as latest (already superseded)
      if (existingMem.is_latest === false) {
        continue;
      }

      // Check if content is different (not a duplicate)
      if (existingMem.content === newContent) {
        continue;
      }

      // Extract entity+attribute from existing memory
      const existEntityAttr = extractEntityAttribute(existingMem.content);
      if (!existEntityAttr) {
        continue;
      }

      // Check if same entity and same attribute (contradiction)
      if (existEntityAttr.entity === newEntityAttr.entity &&
          existEntityAttr.attribute === newEntityAttr.attribute) {
        console.log(`   ⚠️ CONTRADICTION found: "${existingMem.content.substring(0, 50)}..." -> superseding`);

        // Mark old memory as not latest
        try {
          await convex.mutation('memories:patch' as any, {
            id: existingMem._id,
            patch: { is_latest: false },
          });

          supersededIds.push(existingMem._id);
          console.log(`   ✓ Marked memory ${existingMem._id} as is_latest=false`);
        } catch (patchError: any) {
          // Fallback: try alternative mutation name
          try {
            await convex.mutation('memoryOps:updateMemoryLatest' as any, {
              id: existingMem._id,
              isLatest: false,
            });
            supersededIds.push(existingMem._id);
            console.log(`   ✓ Marked memory ${existingMem._id} as is_latest=false (via memoryOps)`);
          } catch (fallbackError: any) {
            console.warn(`   ⚠️ Could not supersede memory: ${fallbackError.message}`);
          }
        }
      }
    }
  } catch (error: any) {
    console.warn(`   ⚠️ Contradiction check failed: ${error.message}`);
  }

  return supersededIds;
}

// ============================================================================
// EXTRACT AND SAVE MEMORIES (COMBINED OPERATION)
// ============================================================================

export interface ExtractAndSaveOptions {
  forceIsCore?: boolean;  // Override isCore classification if provided
  metadata?: Record<string, unknown>;
  containerTags?: string[];
  sourceDocument?: string;
}

export interface ExtractAndSaveResult {
  memories: Array<{
    id: string;
    content: string;
    isCore: boolean;
  }>;
  title: string;
  summary: string;
}

/**
 * Extract memories from content using LLM and save them to the database.
 * This is the unified function that ensures ALL content goes through proper extraction.
 *
 * @param userId - User ID for ownership
 * @param content - Raw content to extract memories from
 * @param options - Optional extraction and save options
 * @returns Saved memories with their IDs
 */
export async function extractAndSaveMemories(
  userId: string,
  content: string,
  options: ExtractAndSaveOptions = {}
): Promise<ExtractAndSaveResult> {
  const { forceIsCore, metadata, containerTags, sourceDocument } = options;

  // Step 1: Extract memories using LLM
  const extraction = await extractMemories(content);

  if (extraction.memories.length === 0) {
    return { memories: [], title: extraction.title, summary: extraction.summary };
  }

  // Step 2: Import database utilities (lazy load to avoid circular deps)
  const { getConvexClient } = await import('../database/convex.js');
  const { embedBatch } = await import('../vector/embeddings.js');

  const convex = getConvexClient();

  // Step 3: Generate embeddings for all memories in batch
  const memoryContents = extraction.memories.map(m => m.content);
  const embeddings = await embedBatch(memoryContents);

  // Step 4: Save each memory to the database
  const savedMemories: Array<{ id: string; content: string; isCore: boolean }> = [];

  for (let i = 0; i < extraction.memories.length; i++) {
    const mem = extraction.memories[i];
    const embedding = embeddings[i];

    // Determine isCore: use forceIsCore if provided, otherwise use extraction result
    const isCore = forceIsCore !== undefined ? forceIsCore : mem.isStatic;

    try {
      // Step 4a: Check for contradictions and supersede old memories
      // This ensures that when a new fact contradicts an existing one,
      // the old memory is marked as is_latest=false
      const supersededIds = await checkAndSupersede(userId, mem.content, embedding, convex);
      if (supersededIds.length > 0) {
        console.log(`   📝 Superseded ${supersededIds.length} existing memory(ies)`);
      }

      // Step 4b: Save the new memory
      const id = await convex.mutation('memories:create' as any, {
        userId,
        content: mem.content,
        isCore,
        sourceDocument: sourceDocument || undefined,
        containerTags: containerTags || undefined,
        embedding,
        metadata: metadata || undefined,
        // Auto-forgetting fields from extraction
        memoryKind: mem.kind,
        expiresAt: mem.expiresAt,
      });

      if (id) {
        savedMemories.push({
          id: id as string,
          content: mem.content,
          isCore,
        });
        console.log(`   💾 Saved memory: "${mem.content.substring(0, 50)}..." (${isCore ? 'core' : 'dynamic'})`);
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Failed to save memory: ${error.message}`);
    }
  }

  return {
    memories: savedMemories,
    title: extraction.title,
    summary: extraction.summary,
  };
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

export const MemoryExtractor = {
  extractMemories,
  extractAndSaveMemories,
  generateTitle,
  generateSummary,
  classifyMemory,
  classifyMemoryKind,
  hasTemporalContent,
  calculateExpiry,
  convertDates
};
