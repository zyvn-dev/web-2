const SEVERITY_KEYWORDS = {
  critical: ['sinking', 'capsizing', 'explosion', 'fire', 'abandon ship', 'man overboard', 'collision', 'flooding', 'hull breach', 'mayday'],
  high: ['engine failure', 'power loss', 'taking on water', 'medical emergency', 'injury', 'injuries', 'stranded', 'disabled', 'grounding', 'piracy', 'attack', 'hostile'],
  medium: ['mechanical', 'steering', 'navigation failure', 'fuel leak', 'cargo shift', 'damage', 'broken'],
  low: ['delay', 'minor', 'inspection', 'maintenance', 'weather', 'slow'],
};

const CATEGORY_PATTERNS = [
  { category: 'fire', patterns: ['fire', 'explosion', 'smoke', 'burning'] },
  { category: 'flooding', patterns: ['flood', 'water', 'leak', 'sinking', 'hull breach', 'taking on water'] },
  { category: 'mechanical', patterns: ['engine', 'mechanical', 'steering', 'power', 'propulsion', 'rudder'] },
  { category: 'medical', patterns: ['medical', 'injury', 'injuries', 'injured', 'ill', 'casualt', 'unconscious', 'sick'] },
  { category: 'navigation', patterns: ['navigation', 'grounding', 'collision', 'aground'] },
  { category: 'security', patterns: ['piracy', 'pirates', 'attack', 'hostile', 'boarded', 'armed'] },
  { category: 'cargo', patterns: ['cargo', 'spill', 'shift', 'container'] },
  { category: 'weather', patterns: ['storm', 'weather', 'wave', 'wind', 'cyclone'] },
];

export function analyzeDistressMessage(message, shipContext = {}) {
  const lower = message.toLowerCase();

  let severity = 'low';
  let severityScore = 1;
  for (const [level, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const scores = { critical: 4, high: 3, medium: 2, low: 1 };
        if (scores[level] > severityScore) {
          severity = level;
          severityScore = scores[level];
        }
      }
    }
  }

  const categories = [];
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    for (const p of patterns) {
      if (lower.includes(p)) { categories.push(category); break; }
    }
  }
  if (categories.length === 0) categories.push('general');

  const injuryMatch = lower.match(/(\d+)\s*(injured|injuries|casualties|crew\s*(down|hurt|injured))/);
  const injuryCount = injuryMatch ? parseInt(injuryMatch[1]) : null;

  const damageMatch = lower.match(/(extensive|severe|major|moderate|minor|total)\s*damage/);
  const damageEstimate = damageMatch ? damageMatch[1] : null;

  const urgencyIndicators = ['immediate', 'urgent', 'asap', 'now', 'emergency', 'mayday', 'sos'];
  const isUrgent = urgencyIndicators.some(u => lower.includes(u));

  if (injuryCount && injuryCount > 5 && severityScore < 4) {
    severity = 'critical';
    severityScore = 4;
  }
  if (isUrgent && severityScore < 3) {
    severity = 'high';
    severityScore = 3;
  }

  const assistanceNeeded = [];
  if (categories.includes('medical')) assistanceNeeded.push('medical_evacuation');
  if (categories.includes('fire')) assistanceNeeded.push('firefighting_support');
  if (categories.includes('flooding')) assistanceNeeded.push('pumping_equipment');
  if (categories.includes('mechanical')) assistanceNeeded.push('towing');
  if (lower.includes('fuel') || lower.includes('ran out')) assistanceNeeded.push('fuel_transfer');

  return {
    severity,
    severityScore,
    categories,
    injuryCount,
    damageEstimate,
    isUrgent,
    assistanceNeeded,
    summary: generateSummary(severity, categories, injuryCount, damageEstimate, shipContext),
    originalMessage: message,
    timestamp: Date.now(),
  };
}

function generateSummary(severity, categories, injuryCount, damageEstimate, ctx) {
  const shipName = ctx.name || 'Unknown vessel';
  const parts = [`${shipName}: ${severity.toUpperCase()} - ${categories.join(', ')}`];
  if (injuryCount) parts.push(`${injuryCount} reported injuries`);
  if (damageEstimate) parts.push(`${damageEstimate} damage`);
  return parts.join('. ');
}

export function prioritizeAlerts(alerts) {
  return [...alerts].sort((a, b) => {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const aSev = sevOrder[a.severity] ?? 3;
    const bSev = sevOrder[b.severity] ?? 3;
    if (aSev !== bSev) return aSev - bSev;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}
